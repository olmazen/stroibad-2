<?php

declare(strict_types=1);

umask(0077);

use Egoe\Email\EmailLeadTransport;
use Egoe\Leads\Database;
use Egoe\Leads\Settings;

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "ERROR: CLI only\n");
    exit(1);
}

function failControl(string $message): never
{
    throw new RuntimeException($message);
}

function controlUid(): int
{
    if (function_exists('posix_geteuid')) {
        return posix_geteuid();
    }
    return getmyuid();
}

/** @return array<string,mixed> */
function ownedPath(string $path, int $type, ?int $mode = null): array
{
    $metadata = @lstat($path);
    if (!is_array($metadata)
        || (((int)($metadata['mode'] ?? 0)) & 0170000) !== $type
        || ($metadata['uid'] ?? null) !== controlUid()
        || (((int)$metadata['mode']) & 0022) !== 0
        || ($mode !== null && (((int)$metadata['mode']) & 0777) !== $mode)
    ) {
        failControl("Unsafe server path: {$path}");
    }
    return $metadata;
}

function atomicWrite(string $path, string $contents, int $mode): void
{
    $directory = dirname($path);
    ownedPath($directory, 0040000);
    $temporary = $directory . '/.' . basename($path) . '.' . bin2hex(random_bytes(12)) . '.tmp';
    try {
        $written = @file_put_contents($temporary, $contents, LOCK_EX);
        if ($written !== strlen($contents) || !@chmod($temporary, $mode)) {
            failControl('Unable to write the private server file');
        }
        ownedPath($temporary, 0100000, $mode);
        if (!@rename($temporary, $path)) {
            failControl('Unable to activate the private server file');
        }
        clearstatcache(true, $path);
        ownedPath($path, 0100000, $mode);
    } finally {
        if (file_exists($temporary) || is_link($temporary)) {
            @unlink($temporary);
        }
    }
}

function markerPresent(string $marker): bool
{
    if (!file_exists($marker) && !is_link($marker)) {
        return false;
    }
    ownedPath($marker, 0100000, 0600);
    if (is_link($marker) || file_get_contents($marker) !== 'egoe-life.ru') {
        failControl('Email approval marker is invalid');
    }
    return true;
}

function removeMarker(string $marker): void
{
    if (markerPresent($marker) && !@unlink($marker)) {
        failControl('Unable to disable the email approval marker');
    }
    clearstatcache(true, $marker);
}

function createMarker(string $marker): void
{
    if (file_exists($marker) || is_link($marker)) {
        failControl('Email approval marker already exists');
    }
    atomicWrite($marker, 'egoe-life.ru', 0600);
    if (!markerPresent($marker)) {
        failControl('Email approval marker failed validation');
    }
}

/** @param array<string,mixed> $config */
function configSource(array $config): string
{
    return "<?php\n\ndeclare(strict_types=1);\n\nreturn " . var_export($config, true) . ";\n";
}

/** @return array<string,mixed> */
function loadPrivateConfig(string $path): array
{
    ownedPath($path, 0100000, 0600);
    if (is_link($path) || !is_readable($path)) {
        failControl('Private lead configuration is unavailable');
    }
    $config = (static fn (string $file): mixed => require $file)($path);
    if (!is_array($config)) {
        failControl('Private lead configuration must return an array');
    }
    return $config;
}

/** @return array<string,mixed> */
function healthState(string $deployRoot): array
{
    $settings = Settings::load($deployRoot);
    $pdo = Database::connect($deployRoot);
    Database::assertSchema($pdo);
    EmailLeadTransport::production($settings['email']);
    return [
        'ok' => true,
        'schemaVersion' => (int)$pdo->query('PRAGMA user_version')->fetchColumn(),
        'collectionEnabled' => $settings['collection_enabled'] === true,
        'emailDeliveryEnabled' => ($settings['email']['enabled'] ?? false) === true,
    ];
}

$mode = $argv[1] ?? '';
$requestedRoot = $argv[2] ?? '';
$expectedSha = $argv[3] ?? '';
$originalConfig = null;
$configPath = '';
$marker = '';
$markerWasPresent = false;
$configChanged = false;
$markerChanged = false;

try {
    if (!in_array($mode, ['preflight', 'enable', 'disable'], true)) {
        failControl('Mode must be preflight, enable, or disable');
    }
    if (preg_match('/\A[0-9a-f]{40}\z/D', $expectedSha) !== 1) {
        failControl('Expected release SHA is invalid');
    }
    $deployRoot = realpath($requestedRoot);
    if (!is_string($deployRoot)
        || $deployRoot !== $requestedRoot
        || $deployRoot === '/'
        || is_link($requestedRoot)
    ) {
        failControl('Deployment root is invalid');
    }
    ownedPath($deployRoot, 0040000);
    ownedPath($deployRoot . '/state', 0040000);
    ownedPath($deployRoot . '/shared', 0040000);
    $hostnameMarker = $deployRoot . '/state/site-hostname';
    ownedPath($hostnameMarker, 0100000);
    $hostnameValue = file_get_contents($hostnameMarker);
    if (!in_array($hostnameValue, ['egoe-life.ru', "egoe-life.ru\n"], true)) {
        failControl('Deployment hostname marker is invalid');
    }

    $current = $deployRoot . '/current';
    if (!is_link($current)) {
        failControl('Current release link is unavailable');
    }
    $target = readlink($current);
    if ($target !== 'releases/' . $expectedSha) {
        failControl('Current production release does not match the approved SHA');
    }
    $expectedReleasePath = $deployRoot . '/releases/' . $expectedSha;
    if (is_link($expectedReleasePath)) {
        failControl('Expected release directory must not be a symlink');
    }
    ownedPath($expectedReleasePath, 0040000);
    $releaseRoot = realpath($current);
    $expectedReleaseRoot = realpath($expectedReleasePath);
    if (!is_string($releaseRoot)
        || !is_string($expectedReleaseRoot)
        || $releaseRoot !== $expectedReleaseRoot
    ) {
        failControl('Current release target is invalid');
    }
    $releaseManifest = $releaseRoot . '/release.json';
    ownedPath($releaseManifest, 0100000);
    if (is_link($releaseManifest)) {
        failControl('Release manifest must not be a symlink');
    }
    $release = json_decode((string)file_get_contents($releaseManifest), true, 32, JSON_THROW_ON_ERROR);
    if (!is_array($release) || ($release['source']['commit'] ?? null) !== $expectedSha) {
        failControl('Release manifest does not match the approved SHA');
    }

    $lockPath = $deployRoot . '/state/deploy.lock';
    if (is_link($lockPath)) {
        failControl('Deployment lock must not be a symlink');
    }
    $lock = @fopen($lockPath, 'c+');
    if (!is_resource($lock) || !@chmod($lockPath, 0600)) {
        failControl('Deployment lock is unavailable');
    }
    ownedPath($lockPath, 0100000, 0600);
    if (!flock($lock, LOCK_EX | LOCK_NB)) {
        failControl('Another production operation is active');
    }

    $backendPath = $releaseRoot . '/api/leads/lib/LeadBackend.php';
    $emailPath = $releaseRoot . '/api/leads/lib/EmailDelivery.php';
    ownedPath($backendPath, 0100000);
    ownedPath($emailPath, 0100000);
    require $backendPath;
    require $emailPath;
    if (Settings::CURRENT_CONSENT_VERSION !== '2026-09-04') {
        failControl('Current release is not the approved email-consent release');
    }
    putenv('EGOE_DEPLOY_ROOT=' . $deployRoot);

    $configPath = $deployRoot . '/shared/leads/config.php';
    $config = loadPrivateConfig($configPath);
    $originalConfig = file_get_contents($configPath);
    if (!is_string($originalConfig)) {
        failControl('Private lead configuration is unreadable');
    }
    $marker = $deployRoot . '/state/email-delivery-approved';
    $markerWasPresent = markerPresent($marker);

    if ($mode === 'preflight') {
        $health = healthState($deployRoot);
        $health['mode'] = 'preflight';
        $health['markerPresent'] = $markerWasPresent;
        echo json_encode($health, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
        exit(0);
    }

    removeMarker($marker);
    $markerChanged = $markerWasPresent;
    $config['email'] = [
        'enabled' => $mode === 'enable',
        'recipient' => 'zakaz@egoe-life.ru',
        'sender' => 'zakaz@egoe-life.ru',
        'sender_name' => 'EGOE — сайт',
        'sendmail_path' => '/usr/sbin/sendmail',
        'timeout_seconds' => 10,
    ];
    atomicWrite($configPath, configSource($config), 0600);
    $configChanged = true;

    $health = healthState($deployRoot);
    if ($health['emailDeliveryEnabled'] !== false) {
        failControl('Email must remain disabled until its approval marker exists');
    }

    if ($mode === 'enable') {
        foreach (['proc_open', 'proc_get_status', 'proc_terminate', 'proc_close'] as $function) {
            if (!function_exists($function)) {
                failControl('Required local mail function is unavailable');
            }
        }
        if (!is_file('/usr/sbin/sendmail') || !is_executable('/usr/sbin/sendmail')) {
            failControl('Local Exim sendmail interface is unavailable');
        }
        createMarker($marker);
        $markerChanged = true;
        $health = healthState($deployRoot);
        if ($health['emailDeliveryEnabled'] !== true) {
            failControl('Email delivery did not become effective');
        }
    }

    $health['mode'] = $mode;
    $health['markerPresent'] = markerPresent($marker);
    echo json_encode($health, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
} catch (Throwable $error) {
    if ($configChanged && is_string($originalConfig) && $configPath !== '') {
        try {
            atomicWrite($configPath, $originalConfig, 0600);
        } catch (Throwable) {
            // Preserve the original failure without exposing configuration contents.
        }
    }
    if ($markerChanged && $marker !== '') {
        try {
            if (file_exists($marker) && !is_link($marker)) {
                @unlink($marker);
            }
            if ($markerWasPresent) {
                createMarker($marker);
            }
        } catch (Throwable) {
            // The workflow's follow-up health check will fail closed.
        }
    }
    fwrite(STDERR, 'ERROR: ' . $error->getMessage() . "\n");
    exit(1);
}
