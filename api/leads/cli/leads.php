<?php

declare(strict_types=1);

umask(0077);

use Egoe\Leads\Database;
use Egoe\Leads\BackupRetention;
use Egoe\Leads\CustomerHistory;
use Egoe\Leads\Relay;
use Egoe\Leads\Runtime;
use Egoe\Leads\Settings;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/lib/LeadBackend.php';

function fail(string $message, int $code = 1): never
{
    fwrite(STDERR, "ERROR: {$message}\n");
    exit($code);
}

/** @return array<string,mixed> */
function loadRuntime(bool $allowCreate = false): array
{
    $root = Runtime::deployRoot();
    if ($allowCreate) {
        Runtime::sharedDirectory($root, true);
    }
    $settings = Settings::load($root);
    $pdo = Database::connect($root);
    return [$root, $settings, $pdo];
}

function initialize(): void
{
    $root = Runtime::deployRoot();
    $directory = Runtime::sharedDirectory($root, true);
    $config = $directory . '/config.php';
    if (!file_exists($config)) {
        $settings = [
            'site_host' => 'www.egoe-life.ru',
            'allowed_hosts' => ['www.egoe-life.ru', 'egoe-life.ru'],
            'collection_enabled' => false,
            'consent_version' => '2026-08-27',
            'ip_hash_key' => bin2hex(random_bytes(32)),
            'minimum_elapsed_ms' => 600,
            'rate_limit' => ['max_requests' => 5, 'window_seconds' => 600],
            'retention_days' => 365,
            'consent_evidence_days' => 1095,
            'backup_retention_days' => 30,
            'relay' => [
                'enabled' => false,
                'url' => '',
                'mode' => 'signal',
                'allow_signal' => false,
                'allow_technical' => false,
                'allow_full' => false,
                'cross_border_confirmed' => false,
                'timeout_seconds' => 3,
                'ca_file' => '',
            ],
        ];
        $body = "<?php\n\ndeclare(strict_types=1);\n\nreturn " . var_export($settings, true) . ";\n";
        $temporary = $config . '.tmp.' . getmypid();
        if (file_put_contents($temporary, $body, LOCK_EX) === false || !rename($temporary, $config)) {
            @unlink($temporary);
            fail('Unable to create server configuration');
        }
        @chmod($config, 0600);
    }
    @chmod($config, 0600);
    [, $settings, $pdo] = loadRuntime();
    $version = (int)$pdo->query('PRAGMA user_version')->fetchColumn();
    $relayState = ($settings['relay']['enabled'] ?? false) === true ? 'on' : 'off';
    $collectionState = ($settings['collection_enabled'] ?? false) === true ? 'on' : 'off';
    echo "INITIALIZED schema={$version} collection={$collectionState} relay={$relayState}\n";
}

function health(): void
{
    if (!extension_loaded('sqlite3') || !class_exists(SQLite3::class) || !method_exists(SQLite3::class, 'backup')) {
        fail('sqlite3 online backup support is unavailable');
    }
    [$root, $settings, $pdo] = loadRuntime();
    $directory = Runtime::sharedDirectory($root);
    if (!is_writable($directory)) {
        fail('Persistent lead directory is not writable');
    }
    $directoryPermissions = fileperms($directory);
    if ($directoryPermissions === false || ($directoryPermissions & 0777) !== 0700) {
        fail('Persistent lead directory permissions must be 0700');
    }
    $configPath = $directory . '/config.php';
    $databasePath = $directory . '/leads.sqlite3';
    $configPermissions = fileperms($configPath);
    $databasePermissions = fileperms($databasePath);
    if ($configPermissions === false || ($configPermissions & 0777) !== 0600
        || $databasePermissions === false || ($databasePermissions & 0777) !== 0600
    ) {
        fail('Lead config/database permissions must be 0600');
    }
    $version = (int)$pdo->query('PRAGMA user_version')->fetchColumn();
    if ($version !== 2) {
        fail('Unexpected lead database schema');
    }
    Database::assertSchema($pdo);
    $pdo->query('SELECT 1 FROM leads LIMIT 1');
    $pdo->query('SELECT 1 FROM outbox LIMIT 1');
    $pdo->query('SELECT 1 FROM consent_evidence LIMIT 1');
    echo json_encode([
        'ok' => true,
        'schemaVersion' => $version,
        'collectionEnabled' => ($settings['collection_enabled'] ?? false) === true,
        'relayEnabled' => ($settings['relay']['enabled'] ?? false) === true,
    ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
}

function viewLead(PDO $pdo, string $leadId): void
{
    if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/Di', $leadId) !== 1) {
        fail('Lead ID must be a UUID');
    }
    $statement = $pdo->prepare('SELECT payload_json, received_at FROM leads WHERE lead_id = :lead_id');
    $statement->execute([':lead_id' => strtolower($leadId)]);
    $row = $statement->fetch();
    if (!is_array($row)) {
        fail('Lead not found', 2);
    }
    $payload = json_decode((string)$row['payload_json'], true, 32, JSON_THROW_ON_ERROR);
    $payload['receivedAt'] = $row['received_at'];
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
}

function recentLeads(PDO $pdo, string $requestedLimit): void
{
    if (preg_match('/^(?:[1-9]|[1-9][0-9]|100)$/D', $requestedLimit) !== 1) {
        fail('Recent limit must be an integer from 1 to 100');
    }
    $statement = $pdo->prepare(<<<'SQL'
SELECT lead_id, received_at, form_id, page_path
FROM leads
ORDER BY received_at DESC, rowid DESC
LIMIT :limit
SQL);
    $statement->bindValue(':limit', (int)$requestedLimit, PDO::PARAM_INT);
    $statement->execute();
    echo json_encode(
        $statement->fetchAll(),
        JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    ) . "\n";
}

/** @param array<string,mixed> $settings */
function customerHistory(PDO $pdo, array $settings, string $leadId): void
{
    $history = CustomerHistory::forLead($pdo, $leadId, (string)$settings['ip_hash_key']);
    echo json_encode(
        $history,
        JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    ) . "\n";
}

function backup(string $root): string
{
    $directory = Runtime::sharedDirectory($root) . '/backups';
    if (!is_dir($directory) && !mkdir($directory, 0700, false) && !is_dir($directory)) {
        fail('Unable to create backup directory');
    }
    if (is_link($directory)) {
        fail('Backup directory must not be a symlink');
    }
    @chmod($directory, 0700);
    $path = $directory . '/leads-' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.sqlite3';
    $sourcePath = Runtime::sharedDirectory($root) . '/leads.sqlite3';
    if (!is_file($sourcePath) || is_link($sourcePath)) {
        fail('Lead database is unavailable for backup');
    }
    if (!extension_loaded('sqlite3') || !class_exists(SQLite3::class) || !method_exists(SQLite3::class, 'backup')) {
        fail('sqlite3 online backup support is unavailable');
    }

    $source = null;
    $destination = null;
    $backupError = null;
    try {
        $source = new SQLite3($sourcePath, SQLITE3_OPEN_READONLY);
        $destination = new SQLite3($path, SQLITE3_OPEN_READWRITE | SQLITE3_OPEN_CREATE);
        $source->enableExceptions(true);
        $destination->enableExceptions(true);
        $source->busyTimeout(5000);
        $destination->busyTimeout(5000);
        if (!$source->backup($destination)) {
            throw new RuntimeException('SQLite online backup returned false');
        }
        if ($destination->querySingle('PRAGMA quick_check') !== 'ok') {
            throw new RuntimeException('SQLite backup integrity check failed');
        }
    } catch (Throwable $error) {
        $backupError = $error->getMessage();
    } finally {
        if ($destination instanceof SQLite3) {
            $destination->close();
        }
        if ($source instanceof SQLite3) {
            $source->close();
        }
    }
    if ($backupError !== null) {
        @unlink($path);
        fail('Unable to create consistent SQLite backup: ' . $backupError);
    }
    @chmod($path, 0600);
    $permissions = fileperms($path);
    if ($permissions === false || ($permissions & 0777) !== 0600 || is_link($path) || !is_file($path)) {
        @unlink($path);
        fail('Backup permissions are unsafe');
    }
    echo $path . "\n";
    return $path;
}

function retention(string $root, array $settings, PDO $pdo): void
{
    backup($root);
    $cutoff = (new DateTimeImmutable('now', new DateTimeZone('UTC')))
        ->modify('-' . (int)$settings['retention_days'] . ' days')
        ->format('Y-m-d\TH:i:s.v\Z');
    $evidenceCutoff = (new DateTimeImmutable('now', new DateTimeZone('UTC')))
        ->modify('-' . (int)$settings['consent_evidence_days'] . ' days')
        ->format('Y-m-d\TH:i:s.v\Z');
    $backupCutoff = time() - ((int)$settings['backup_retention_days'] * 86400);
    $backupDirectory = Runtime::sharedDirectory($root) . '/backups';
    $purgedBackups = BackupRetention::prune($backupDirectory, $backupCutoff);
    $pdo->exec('BEGIN IMMEDIATE');
    try {
        $statement = $pdo->prepare('DELETE FROM leads WHERE received_at < :cutoff');
        $statement->execute([':cutoff' => $cutoff]);
        $evidence = $pdo->prepare('DELETE FROM consent_evidence WHERE received_at < :cutoff');
        $evidence->execute([':cutoff' => $evidenceCutoff]);
        $pdo->prepare('DELETE FROM rate_limits WHERE window_started_at < :cutoff')->execute([':cutoff' => time() - 172800]);
        $deletedLeads = $statement->rowCount();
        $deletedEvidence = $evidence->rowCount();
        $pdo->exec('COMMIT');
    } catch (Throwable $error) {
        try {
            $pdo->exec('ROLLBACK');
        } catch (Throwable) {
            // SQLite may already have closed the failed transaction.
        }
        throw $error;
    }
    $summary = 'DELETED leads=' . $deletedLeads . ' evidence=' . $deletedEvidence . ' backups=' . $purgedBackups;
    $lifecycleLog = Runtime::sharedDirectory($root) . '/lifecycle.log';
    if (is_link($lifecycleLog)) {
        fail('Lifecycle log must not be a symlink');
    }
    if (file_put_contents($lifecycleLog, Runtime::utcNow() . ' ' . $summary . "\n", FILE_APPEND | LOCK_EX) === false) {
        fail('Unable to write lifecycle log');
    }
    @chmod($lifecycleLog, 0600);
    echo $summary . "\n";
}

function deleteLead(PDO $pdo, string $leadId, bool $withEvidence): void
{
    if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/Di', $leadId) !== 1) {
        fail('Lead ID must be a UUID');
    }
    $pdo->exec('BEGIN IMMEDIATE');
    try {
        $statement = $pdo->prepare('DELETE FROM leads WHERE lead_id = :lead_id');
        $statement->execute([':lead_id' => strtolower($leadId)]);
        $deleted = $statement->rowCount();
        $evidenceDeleted = 0;
        if ($withEvidence) {
            $evidence = $pdo->prepare('DELETE FROM consent_evidence WHERE lead_id = :lead_id');
            $evidence->execute([':lead_id' => strtolower($leadId)]);
            $evidenceDeleted = $evidence->rowCount();
        }
        $pdo->exec('COMMIT');
        echo "DELETED lead={$deleted} evidence={$evidenceDeleted} evidenceRetained=" . ($withEvidence ? 'false' : 'true') . "\n";
    } catch (Throwable $error) {
        try {
            $pdo->exec('ROLLBACK');
        } catch (Throwable) {
            // Transaction may already be closed by SQLite after a fatal statement.
        }
        throw $error;
    }
}

try {
    $command = $argv[1] ?? 'help';
    if ($command === 'init') {
        initialize();
        exit(0);
    }
    [$root, $settings, $pdo] = loadRuntime();
    switch ($command) {
        case 'migrate':
            Database::migrate($pdo);
            echo "MIGRATED\n";
            break;
        case 'health':
            health();
            break;
        case 'retry':
            $limit = isset($argv[2]) ? (int)$argv[2] : 20;
            echo json_encode(Relay::retry($pdo, $settings, $limit), JSON_THROW_ON_ERROR) . "\n";
            break;
        case 'view':
            viewLead($pdo, (string)($argv[2] ?? ''));
            break;
        case 'recent':
            recentLeads($pdo, (string)($argv[2] ?? '20'));
            break;
        case 'customer-history':
            if (count($argv) !== 3) {
                fail('customer-history requires exactly one lead UUID');
            }
            customerHistory($pdo, $settings, (string)$argv[2]);
            break;
        case 'backup':
            backup($root);
            break;
        case 'retention':
            retention($root, $settings, $pdo);
            break;
        case 'delete':
            deleteLead($pdo, (string)($argv[2] ?? ''), in_array('--with-evidence', $argv, true));
            break;
        default:
            echo "Usage: php api/leads/cli/leads.php init|migrate|health|retry [limit]|recent [limit]|view <uuid>|customer-history <uuid>|backup|retention|delete <uuid> [--with-evidence]\n";
            exit($command === 'help' ? 0 : 1);
    }
} catch (Throwable $error) {
    fail($error->getMessage());
}
