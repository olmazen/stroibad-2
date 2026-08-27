<?php

declare(strict_types=1);

namespace Egoe\Leads;

use DateTimeImmutable;
use DateTimeZone;
use JsonException;
use PDO;
use PDOException;
use RuntimeException;
use Throwable;

final class HttpFailure extends RuntimeException
{
    public function __construct(
        public readonly int $status,
        public readonly string $publicCode,
        string $publicMessage
    ) {
        parent::__construct($publicMessage);
    }
}

final class Runtime
{
    private const SITE_MARKER = 'egoe-life.ru';
    private const COLLECTION_MARKER = 'collection-approved';
    private const RELAY_MARKER = 'relay-approved';
    private const TELEGRAM_HISTORY_MARKER = 'telegram-history-approved';
    private const TELEGRAM_DELIVERY_MARKER = 'telegram-delivery-approved';

    public static function deployRoot(?string $start = null): string
    {
        $candidates = [];
        $override = getenv('EGOE_DEPLOY_ROOT');
        if (is_string($override) && $override !== '') {
            $candidates[] = $override;
        }

        $cursor = realpath($start ?? __DIR__);
        for ($depth = 0; is_string($cursor) && $cursor !== '' && $depth < 10; $depth += 1) {
            $candidates[] = $cursor;
            $parent = dirname($cursor);
            if ($parent === $cursor) {
                break;
            }
            $cursor = $parent;
        }

        foreach (array_unique($candidates) as $candidate) {
            $root = realpath($candidate);
            if (!is_string($root) || $root === '/' || is_link($root)) {
                continue;
            }
            $marker = $root . '/state/site-hostname';
            if (!is_file($marker) || is_link($marker)) {
                continue;
            }
            $value = file_get_contents($marker);
            if (is_string($value) && trim($value) === self::SITE_MARKER) {
                return $root;
            }
        }

        throw new RuntimeException('Lead runtime root is unavailable');
    }

    public static function sharedDirectory(string $deployRoot, bool $create = false): string
    {
        $sharedRoot = $deployRoot . '/shared';
        $directory = $sharedRoot . '/leads';
        if ($create) {
            if (!is_dir($sharedRoot) || is_link($sharedRoot)) {
                throw new RuntimeException('Persistent shared root is unavailable');
            }
            if (!is_dir($directory) && !mkdir($directory, 0700, false) && !is_dir($directory)) {
                throw new RuntimeException('Unable to create persistent lead directory');
            }
            @chmod($directory, 0700);
        }
        if (!is_dir($directory) || is_link($directory)) {
            throw new RuntimeException('Persistent lead directory is unavailable');
        }
        $permissions = fileperms($directory);
        if ($permissions === false || ($permissions & 0777) !== 0700) {
            throw new RuntimeException('Persistent lead directory permissions must be 0700');
        }
        $realShared = realpath($sharedRoot);
        $realDirectory = realpath($directory);
        if (!is_string($realShared) || !is_string($realDirectory) || !str_starts_with($realDirectory . '/', $realShared . '/')) {
            throw new RuntimeException('Persistent lead directory escaped shared root');
        }
        return $realDirectory;
    }

    public static function collectionApproved(string $deployRoot): bool
    {
        return self::approvedMarker($deployRoot, self::COLLECTION_MARKER);
    }

    public static function relayApproved(string $deployRoot): bool
    {
        return self::approvedMarker($deployRoot, self::RELAY_MARKER, 0600);
    }

    public static function telegramHistoryApproved(string $deployRoot): bool
    {
        return self::approvedMarker($deployRoot, self::TELEGRAM_HISTORY_MARKER, 0600);
    }

    public static function telegramDeliveryApproved(string $deployRoot): bool
    {
        return self::approvedMarker($deployRoot, self::TELEGRAM_DELIVERY_MARKER, 0600);
    }

    private static function approvedMarker(string $deployRoot, string $markerName, ?int $requiredPermissions = null): bool
    {
        $stateDirectory = $deployRoot . '/state';
        $marker = $stateDirectory . '/' . $markerName;
        if (!is_dir($stateDirectory) || is_link($stateDirectory) || !is_file($marker) || is_link($marker)) {
            return false;
        }
        $rootMetadata = @lstat($deployRoot);
        $stateMetadata = @lstat($stateDirectory);
        $markerMetadata = @lstat($marker);
        if (!is_array($rootMetadata) || !is_array($stateMetadata) || !is_array($markerMetadata)) {
            return false;
        }
        $rootMode = ((int)($rootMetadata['mode'] ?? 0)) & 0170000;
        $stateMode = ((int)($stateMetadata['mode'] ?? 0));
        $markerMode = ((int)($markerMetadata['mode'] ?? 0));
        $owner = $rootMetadata['uid'] ?? null;
        if ($rootMode !== 0040000
            || ($stateMode & 0170000) !== 0040000
            || ($markerMode & 0170000) !== 0100000
            || !is_int($owner)
            || ($stateMetadata['uid'] ?? null) !== $owner
            || ($markerMetadata['uid'] ?? null) !== $owner
            || ($stateMode & 0022) !== 0
            || ($markerMode & 0022) !== 0
            || ($requiredPermissions !== null && ($markerMode & 0777) !== $requiredPermissions)
        ) {
            return false;
        }
        $realState = realpath($stateDirectory);
        $realMarker = realpath($marker);
        if (!is_string($realState) || !is_string($realMarker) || dirname($realMarker) !== $realState) {
            return false;
        }
        $value = @file_get_contents($realMarker);
        return $value === self::SITE_MARKER;
    }

    public static function utcNow(): string
    {
        return (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
    }
}

final class Settings
{
    public const CURRENT_CONSENT_VERSION = '2026-08-27';
    private const LEGACY_CONSENT_VERSION = '2026-08-23';

    public static function isCurrentConsentVersion(string $version): bool
    {
        return hash_equals(self::CURRENT_CONSENT_VERSION, $version);
    }

    public static function acceptsConsentVersion(string $version): bool
    {
        return self::isCurrentConsentVersion($version)
            || hash_equals(self::LEGACY_CONSENT_VERSION, $version);
    }

    /** @return array<string,mixed> */
    public static function load(string $deployRoot): array
    {
        $directory = Runtime::sharedDirectory($deployRoot);
        $path = $directory . '/config.php';
        if (!is_file($path) || is_link($path) || !is_readable($path)) {
            throw new RuntimeException('Lead server configuration is unavailable');
        }
        $permissions = fileperms($path);
        if ($permissions === false || ($permissions & 0777) !== 0600) {
            throw new RuntimeException('Lead server configuration permissions must be 0600');
        }
        $loaded = (static fn (string $file): mixed => require $file)($path);
        if (!is_array($loaded)) {
            throw new RuntimeException('Lead server configuration must return an array');
        }

        $defaults = [
            'site_host' => 'www.egoe-life.ru',
            'allowed_hosts' => ['www.egoe-life.ru', 'egoe-life.ru'],
            'collection_enabled' => false,
            'consent_version' => self::CURRENT_CONSENT_VERSION,
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
                'url_sha256' => '',
                'require_json_ok' => true,
            ],
        ];
        $settings = array_replace_recursive($defaults, $loaded);

        if (!is_string($settings['consent_version']) || !self::acceptsConsentVersion($settings['consent_version'])) {
            throw new RuntimeException('consent_version is outside the approved transition allowlist');
        }

        if (!is_bool($settings['collection_enabled'])) {
            throw new RuntimeException('collection_enabled must be boolean');
        }
        $settings['collection_enabled'] = $settings['collection_enabled'] === true
            && Runtime::collectionApproved($deployRoot);

        if (!is_string($settings['ip_hash_key'] ?? null)
            || strlen($settings['ip_hash_key']) < 32
            || str_contains($settings['ip_hash_key'], 'REPLACE_')
            || preg_match('/^(.)\1+$/sD', $settings['ip_hash_key']) === 1
        ) {
            throw new RuntimeException('ip_hash_key must contain at least 32 bytes');
        }
        if (!is_string($settings['site_host']) || !self::validHost($settings['site_host'])) {
            throw new RuntimeException('Invalid site_host');
        }
        if (!is_array($settings['allowed_hosts']) || $settings['allowed_hosts'] === []) {
            throw new RuntimeException('allowed_hosts must be a non-empty array');
        }
        $hosts = [];
        foreach ($settings['allowed_hosts'] as $host) {
            if (!is_string($host) || !self::validHost($host)) {
                throw new RuntimeException('Invalid allowed_hosts entry');
            }
            $hosts[] = strtolower($host);
        }
        $settings['allowed_hosts'] = array_values(array_unique($hosts));

        $rate = $settings['rate_limit'];
        if (!is_array($rate)
            || !is_int($rate['max_requests'] ?? null) || $rate['max_requests'] < 1 || $rate['max_requests'] > 100
            || !is_int($rate['window_seconds'] ?? null) || $rate['window_seconds'] < 10 || $rate['window_seconds'] > 86400
        ) {
            throw new RuntimeException('Invalid rate_limit configuration');
        }
        if (!is_int($settings['minimum_elapsed_ms']) || $settings['minimum_elapsed_ms'] < 0 || $settings['minimum_elapsed_ms'] > 60000) {
            throw new RuntimeException('Invalid minimum_elapsed_ms');
        }
        $retentionLimits = ['retention_days' => 365, 'consent_evidence_days' => 1095];
        foreach ($retentionLimits as $daysKey => $maximum) {
            if (!is_int($settings[$daysKey]) || $settings[$daysKey] < 1 || $settings[$daysKey] > $maximum) {
                throw new RuntimeException("{$daysKey} must be between 1 and {$maximum}");
            }
        }
        if (($settings['backup_retention_days'] ?? null) !== 30) {
            throw new RuntimeException('backup_retention_days must remain exactly 30');
        }

        $relay = $settings['relay'];
        if (!is_array($relay) || !is_bool($relay['enabled'] ?? null)) {
            throw new RuntimeException('Invalid relay configuration');
        }
        $relay['enabled'] = $relay['enabled'] === true && Runtime::relayApproved($deployRoot);
        if ($relay['enabled']) {
            if (!is_int($relay['timeout_seconds'] ?? null) || $relay['timeout_seconds'] < 1 || $relay['timeout_seconds'] > 10) {
                throw new RuntimeException('Invalid relay timeout_seconds');
            }
            $url = $relay['url'] ?? null;
            if (!is_string($url) || !preg_match('~^https://[^\s]+$~D', $url)) {
                throw new RuntimeException('Enabled relay requires an HTTPS server URL');
            }
            $urlSha256 = $relay['url_sha256'] ?? null;
            if (!is_string($urlSha256) || preg_match('/\A[0-9a-f]{64}\z/i', $urlSha256) !== 1) {
                throw new RuntimeException('Enabled relay requires an approved URL SHA-256');
            }
            $urlSha256 = strtolower($urlSha256);
            if (!hash_equals($urlSha256, hash('sha256', $url))) {
                throw new RuntimeException('Relay URL does not match its approved SHA-256');
            }
            $relay['url_sha256'] = $urlSha256;
            if (!is_bool($relay['require_json_ok'] ?? null)) {
                throw new RuntimeException('Invalid relay require_json_ok flag');
            }
            $caFile = $relay['ca_file'] ?? '';
            if (!is_string($caFile)) {
                throw new RuntimeException('Invalid relay ca_file');
            }
            if ($caFile !== '') {
                $realCa = realpath($caFile);
                if (!is_string($realCa) || !is_file($realCa) || is_link($caFile) || !is_readable($realCa)) {
                    throw new RuntimeException('Relay CA file is unavailable');
                }
                $relay['ca_file'] = $realCa;
            }
            $mode = $relay['mode'] ?? null;
            if (!in_array($mode, ['signal', 'technical', 'full'], true)) {
                throw new RuntimeException('Invalid relay mode');
            }
            if (($relay['cross_border_confirmed'] ?? false) !== true) {
                throw new RuntimeException('Any enabled relay requires explicit cross-border approval');
            }
            if ($mode === 'signal' && ($relay['allow_signal'] ?? false) !== true) {
                throw new RuntimeException('Signal relay requires an explicit allow_signal flag');
            }
            if ($mode === 'technical' && (($relay['allow_technical'] ?? false) !== true || ($relay['cross_border_confirmed'] ?? false) !== true)) {
                throw new RuntimeException('Technical relay requires explicit cross-border approval flags');
            }
            if ($mode === 'full' && (($relay['allow_full'] ?? false) !== true || ($relay['cross_border_confirmed'] ?? false) !== true)) {
                throw new RuntimeException('Full relay requires explicit cross-border approval flags');
            }
        }
        $settings['relay'] = $relay;

        return $settings;
    }

    private static function validHost(string $host): bool
    {
        return preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/D', strtolower($host)) === 1;
    }
}

final class Database
{
    public static function connect(string $deployRoot): PDO
    {
        if (!extension_loaded('pdo_sqlite')) {
            throw new RuntimeException('pdo_sqlite is unavailable');
        }
        $directory = Runtime::sharedDirectory($deployRoot);
        $path = $directory . '/leads.sqlite3';
        if (is_link($path)) {
            throw new RuntimeException('Lead database must not be a symlink');
        }
        $pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        @chmod($path, 0600);
        $permissions = fileperms($path);
        if ($permissions === false || ($permissions & 0777) !== 0600) {
            throw new RuntimeException('Lead database permissions must be 0600');
        }
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA busy_timeout = 5000');
        $pdo->exec('PRAGMA journal_mode = WAL');
        self::migrate($pdo);
        return $pdo;
    }

    public static function migrate(PDO $pdo): void
    {
        $currentVersion = (int)$pdo->query('PRAGMA user_version')->fetchColumn();
        if ($currentVersion > 2) {
            throw new RuntimeException('Lead database schema is newer than this release');
        }
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS leads (
  lead_id TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  form_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  page_path TEXT NOT NULL,
  page_title TEXT NOT NULL,
  page_referrer TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consent_accepted_at TEXT NOT NULL,
  consent_document_url TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  ip_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS leads_received_at_idx ON leads(received_at);

CREATE TABLE IF NOT EXISTS consent_evidence (
  lead_id TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  form_id TEXT NOT NULL,
  page_path TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consent_accepted_at TEXT NOT NULL,
  consent_document_url TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS consent_evidence_received_at_idx ON consent_evidence(received_at);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL UNIQUE REFERENCES leads(lead_id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS outbox_due_idx ON outbox(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  ip_hash TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL
);
SQL);
        $evidenceColumns = array_column($pdo->query('PRAGMA table_info(consent_evidence)')->fetchAll(), 'name');
        if (!in_array('form_id', $evidenceColumns, true)) {
            $pdo->exec("ALTER TABLE consent_evidence ADD COLUMN form_id TEXT NOT NULL DEFAULT ''");
        }
        if (!in_array('page_path', $evidenceColumns, true)) {
            $pdo->exec("ALTER TABLE consent_evidence ADD COLUMN page_path TEXT NOT NULL DEFAULT ''");
        }
        $pdo->exec('PRAGMA user_version = 2');
        self::assertSchema($pdo);
    }

    public static function assertSchema(PDO $pdo): void
    {
        if ((int)$pdo->query('PRAGMA user_version')->fetchColumn() !== 2) {
            throw new RuntimeException('Unexpected lead database schema version');
        }
        $expected = [
            'leads' => ['lead_id', 'payload_hash', 'form_id', 'page_path', 'fields_json', 'payload_json', 'ip_hash'],
            'consent_evidence' => ['lead_id', 'payload_hash', 'form_id', 'page_path', 'consent_version', 'consent_accepted_at'],
            'outbox' => ['id', 'lead_id', 'mode', 'payload_json', 'status', 'attempts', 'next_attempt_at'],
            'rate_limits' => ['ip_hash', 'window_started_at', 'request_count'],
        ];
        foreach ($expected as $table => $columns) {
            $actual = array_column($pdo->query("PRAGMA table_info({$table})")->fetchAll(), 'name');
            foreach ($columns as $column) {
                if (!in_array($column, $actual, true)) {
                    throw new RuntimeException("Lead database schema is missing {$table}.{$column}");
                }
            }
        }
    }
}

final class BackupRetention
{
    public static function prune(string $directory, int $cutoff): int
    {
        if (!is_dir($directory) || is_link($directory)) {
            throw new RuntimeException('Backup directory is unavailable or unsafe');
        }
        $matches = glob($directory . '/leads-*.sqlite3');
        if ($matches === false) {
            throw new RuntimeException('Unable to enumerate lead backups');
        }
        $purged = 0;
        foreach ($matches as $backupPath) {
            $basename = basename($backupPath);
            if (preg_match('/^leads-\d{8}-\d{6}-[0-9a-f]{8}\.sqlite3$/D', $basename) !== 1) {
                continue;
            }
            $metadata = @lstat($backupPath);
            if (!is_array($metadata)) {
                throw new RuntimeException("Unable to inspect lead backup: {$basename}");
            }
            $modifiedAt = $metadata['mtime'] ?? null;
            if (!is_int($modifiedAt)) {
                throw new RuntimeException("Unable to read lead backup timestamp: {$basename}");
            }
            if ($modifiedAt >= $cutoff) {
                continue;
            }
            $fileType = ((int)$metadata['mode']) & 0170000;
            if ($fileType !== 0100000) {
                throw new RuntimeException("Expired lead backup is not a regular file: {$basename}");
            }
            if (!@unlink($backupPath)) {
                throw new RuntimeException("Unable to delete expired lead backup: {$basename}");
            }
            $purged += 1;
        }
        return $purged;
    }
}

final class Validator
{
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/Di';

    /** @param array<string,mixed> $settings */
    public static function assertRequestHost(array $settings, array $server): void
    {
        $requestHost = strtolower(trim((string)($server['HTTP_HOST'] ?? $server['SERVER_NAME'] ?? '')));
        if (str_ends_with($requestHost, ':443')) {
            $requestHost = substr($requestHost, 0, -4);
        } elseif (str_contains($requestHost, ':')) {
            throw new HttpFailure(403, 'HOST_REJECTED', 'Адрес запроса не разрешён.');
        }
        if (!in_array($requestHost, $settings['allowed_hosts'], true)) {
            throw new HttpFailure(403, 'HOST_REJECTED', 'Адрес запроса не разрешён.');
        }
    }

    /** @param array<string,mixed> $settings */
    public static function assertRequestProvenance(array $settings, array $server): void
    {
        self::assertRequestHost($settings, $server);
        $origin = trim((string)($server['HTTP_ORIGIN'] ?? ''));
        $referer = trim((string)($server['HTTP_REFERER'] ?? ''));
        if ($origin === '' && $referer === '') {
            throw new HttpFailure(403, 'ORIGIN_REQUIRED', 'Не удалось подтвердить источник запроса.');
        }
        foreach ([$origin, $referer] as $value) {
            if ($value === '') {
                continue;
            }
            $parts = parse_url($value);
            $scheme = strtolower((string)($parts['scheme'] ?? ''));
            $host = strtolower((string)($parts['host'] ?? ''));
            $port = $parts['port'] ?? null;
            if ($scheme !== 'https' || !in_array($host, $settings['allowed_hosts'], true) || ($port !== null && $port !== 443)) {
                throw new HttpFailure(403, 'ORIGIN_REJECTED', 'Источник запроса не разрешён.');
            }
        }
    }

    /** @param array<string,mixed> $settings
     *  @return array<string,mixed>
     */
    public static function payload(array $input, array $settings): array
    {
        self::onlyKeys($input, ['schemaVersion', 'leadId', 'formId', 'tag', 'createdAt', 'consent', 'page', 'spamCheck', 'fields', 'journey'], 'payload');
        if (($input['schemaVersion'] ?? null) !== 1) {
            throw new HttpFailure(422, 'SCHEMA_INVALID', 'Неподдерживаемая версия заявки.');
        }
        $leadId = self::text($input['leadId'] ?? null, 36, 'leadId');
        if (preg_match(self::UUID, $leadId) !== 1) {
            throw new HttpFailure(422, 'LEAD_ID_INVALID', 'Некорректный номер заявки.');
        }
        $formId = self::text($input['formId'] ?? null, 120, 'formId');
        if (preg_match('/^[\p{L}\p{N}_.:\/-]+$/uD', $formId) !== 1) {
            throw new HttpFailure(422, 'FORM_ID_INVALID', 'Некорректный идентификатор формы.');
        }
        $tag = self::text($input['tag'] ?? null, 200, 'tag');
        $createdAt = self::timestamp($input['createdAt'] ?? null, 'createdAt');
        $createdTime = new DateTimeImmutable($createdAt);
        $serverTime = new DateTimeImmutable('now', new DateTimeZone('UTC'));
        if ($createdTime->getTimestamp() > $serverTime->getTimestamp() + 600
            || $createdTime->getTimestamp() < $serverTime->getTimestamp() - 86400
        ) {
            throw new HttpFailure(422, 'TIMESTAMP_INVALID', 'Время создания заявки недопустимо. Обновите страницу.');
        }

        $consent = self::object($input['consent'] ?? null, 'consent');
        self::onlyKeys($consent, ['accepted', 'version', 'acceptedAt', 'documentUrl'], 'consent');
        if (($consent['accepted'] ?? null) !== true) {
            throw new HttpFailure(422, 'CONSENT_REQUIRED', 'Необходимо согласие на обработку персональных данных.');
        }
        $consentVersion = self::text($consent['version'] ?? null, 40, 'consent.version');
        if (!Settings::acceptsConsentVersion($consentVersion)) {
            throw new HttpFailure(422, 'CONSENT_VERSION_INVALID', 'Версия согласия устарела. Обновите страницу.');
        }
        $acceptedAt = self::timestamp($consent['acceptedAt'] ?? null, 'consent.acceptedAt');
        $acceptedTime = new DateTimeImmutable($acceptedAt);
        if ($acceptedTime->getTimestamp() > $serverTime->getTimestamp() + 600
            || $acceptedTime->getTimestamp() < $serverTime->getTimestamp() - 86400
            || abs($acceptedTime->getTimestamp() - $createdTime->getTimestamp()) > 300
        ) {
            throw new HttpFailure(422, 'CONSENT_TIMESTAMP_INVALID', 'Время согласия не соответствует заявке.');
        }
        $documentUrl = self::sameSitePath(self::text($consent['documentUrl'] ?? null, 500, 'consent.documentUrl'), $settings, '/consent/');

        $page = self::object($input['page'] ?? null, 'page');
        self::onlyKeys($page, ['url', 'title', 'referrer'], 'page');
        $pagePath = self::sameSitePath(self::text($page['url'] ?? null, 1500, 'page.url'), $settings);
        $pageTitle = self::optionalText($page['title'] ?? '', 300, 'page.title');
        $pageReferrer = self::minimizedReferrer(self::optionalText($page['referrer'] ?? '', 1500, 'page.referrer'), $settings);
        $journey = self::journey($input['journey'] ?? [], $createdTime);
        if (!Settings::isCurrentConsentVersion($consentVersion) && $journey !== []) {
            throw new HttpFailure(
                422,
                'JOURNEY_CONSENT_REQUIRED',
                'История просмотра недоступна для этой версии согласия. Обновите страницу.'
            );
        }

        $spam = self::object($input['spamCheck'] ?? null, 'spamCheck');
        self::onlyKeys($spam, ['website', 'elapsedMs'], 'spamCheck');
        $website = self::optionalText($spam['website'] ?? '', 500, 'spamCheck.website');
        $elapsed = $spam['elapsedMs'] ?? null;
        if (!is_int($elapsed) && !is_float($elapsed)) {
            throw new HttpFailure(422, 'TIMING_INVALID', 'Некорректные данные формы.');
        }
        $elapsedMs = (int)$elapsed;
        if ($elapsedMs < 0 || $elapsedMs > 86400000) {
            throw new HttpFailure(422, 'TIMING_INVALID', 'Некорректные данные формы.');
        }

        $fields = self::object($input['fields'] ?? null, 'fields');
        if (array_is_list($fields) || count($fields) < 1 || count($fields) > 40) {
            throw new HttpFailure(422, 'FIELDS_INVALID', 'Заполните данные заявки.');
        }
        $normalizedFields = [];
        $totalBytes = 0;
        $hasPhone = false;
        foreach ($fields as $key => $value) {
            if (!is_string($key) || !is_string($value)) {
                throw new HttpFailure(422, 'FIELDS_INVALID', 'Поля заявки должны содержать текст.');
            }
            $cleanKey = self::text($key, 100, 'field name');
            $cleanValue = self::optionalText($value, 2000, 'field value');
            $totalBytes += strlen($cleanKey) + strlen($cleanValue);
            if ($totalBytes > 24000) {
                throw new HttpFailure(413, 'FIELDS_TOO_LARGE', 'Данные заявки слишком большие.');
            }
            if (preg_match('/тел|phone/iu', $cleanKey) === 1) {
                if ($cleanValue !== '') {
                    $digits = preg_replace('/\D+/', '', $cleanValue) ?? '';
                    if (!(strlen($digits) === 10 || (strlen($digits) === 11 && ($digits[0] === '7' || $digits[0] === '8')))) {
                        throw new HttpFailure(422, 'CONTACT_INVALID', 'Укажите корректный телефон.');
                    }
                    if (strlen($digits) === 10) {
                        $digits = '7' . $digits;
                    } elseif ($digits[0] === '8') {
                        $digits = '7' . substr($digits, 1);
                    }
                    $cleanValue = '+' . $digits;
                    $hasPhone = true;
                }
            }
            if ($cleanValue !== '' && preg_match('/почт|e-?mail/iu', $cleanKey) === 1) {
                if (filter_var($cleanValue, FILTER_VALIDATE_EMAIL) === false) {
                    throw new HttpFailure(422, 'CONTACT_INVALID', 'Укажите корректную электронную почту.');
                }
            }
            $normalizedFields[$cleanKey] = $cleanValue;
        }
        if (!$hasPhone) {
            throw new HttpFailure(422, 'CONTACT_REQUIRED', 'Укажите телефон.');
        }

        return [
            'schemaVersion' => 1,
            'leadId' => strtolower($leadId),
            'formId' => $formId,
            'tag' => $tag,
            'createdAt' => $createdAt,
            'consent' => [
                'accepted' => true,
                'version' => $consentVersion,
                'acceptedAt' => $acceptedAt,
                'documentUrl' => $documentUrl,
            ],
            'page' => [
                'path' => $pagePath,
                'title' => $pageTitle,
                'referrer' => $pageReferrer,
            ],
            'journey' => $journey,
            'spamCheck' => ['website' => $website, 'elapsedMs' => $elapsedMs],
            'fields' => $normalizedFields,
        ];
    }

    /** @param array<string,mixed> $value */
    private static function onlyKeys(array $value, array $allowed, string $name): void
    {
        $unexpected = array_diff(array_keys($value), $allowed);
        if ($unexpected !== []) {
            throw new HttpFailure(422, 'SCHEMA_INVALID', "Лишние поля в {$name}.");
        }
    }

    /** @return array<string,mixed> */
    private static function object(mixed $value, string $name): array
    {
        if (!is_array($value)) {
            throw new HttpFailure(422, 'SCHEMA_INVALID', "Поле {$name} должно быть объектом.");
        }
        return $value;
    }

    private static function text(mixed $value, int $max, string $name): string
    {
        if (!is_string($value)) {
            throw new HttpFailure(422, 'SCHEMA_INVALID', "Поле {$name} должно быть текстом.");
        }
        $clean = trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value) ?? '');
        if ($clean === '' || mb_strlen($clean, 'UTF-8') > $max) {
            throw new HttpFailure(422, 'FIELD_INVALID', "Некорректное поле {$name}.");
        }
        return $clean;
    }

    private static function optionalText(mixed $value, int $max, string $name): string
    {
        if (!is_string($value) || mb_strlen($value, 'UTF-8') > $max) {
            throw new HttpFailure(422, 'FIELD_INVALID', "Некорректное поле {$name}.");
        }
        return trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value) ?? '');
    }

    /** @return list<array{path:string,title:string,viewedAt:string}> */
    private static function journey(mixed $value, DateTimeImmutable $createdTime): array
    {
        if (!is_array($value) || !array_is_list($value) || count($value) > 20) {
            throw new HttpFailure(422, 'JOURNEY_INVALID', 'Некорректная история просмотра. Обновите страницу.');
        }
        $normalized = [];
        $paths = [];
        $previousTimestamp = null;
        foreach ($value as $index => $entryValue) {
            $entry = self::object($entryValue, "journey.{$index}");
            self::onlyKeys($entry, ['path', 'title', 'viewedAt'], "journey.{$index}");
            $path = self::journeyPath($entry['path'] ?? null, "journey.{$index}.path");
            if (isset($paths[$path])) {
                throw new HttpFailure(422, 'JOURNEY_INVALID', 'История просмотра содержит повторы. Обновите страницу.');
            }
            $paths[$path] = true;
            $title = self::optionalText($entry['title'] ?? '', 160, "journey.{$index}.title");
            $title = preg_replace('/\s+/u', ' ', $title) ?? '';
            $viewedAt = self::timestamp($entry['viewedAt'] ?? null, "journey.{$index}.viewedAt");
            $viewedTime = new DateTimeImmutable($viewedAt);
            if ($viewedTime->getTimestamp() > $createdTime->getTimestamp() + 600
                || $viewedTime->getTimestamp() < $createdTime->getTimestamp() - 86400
                || ($previousTimestamp !== null && $viewedTime->getTimestamp() < $previousTimestamp)
            ) {
                throw new HttpFailure(422, 'JOURNEY_INVALID', 'Время истории просмотра недопустимо. Обновите страницу.');
            }
            $previousTimestamp = $viewedTime->getTimestamp();
            $normalized[] = ['path' => $path, 'title' => $title, 'viewedAt' => $viewedAt];
        }
        return $normalized;
    }

    private static function journeyPath(mixed $value, string $name): string
    {
        $path = self::text($value, 500, $name);
        if (!str_starts_with($path, '/')
            || str_starts_with($path, '//')
            || str_contains($path, '?')
            || str_contains($path, '#')
            || preg_match('/[\r\n]/u', $path) === 1
        ) {
            throw new HttpFailure(422, 'JOURNEY_INVALID', 'История просмотра содержит некорректный адрес.');
        }
        $normalized = '/' . ltrim((string)preg_replace('~/+~', '/', $path), '/');
        if (!hash_equals($normalized, $path)) {
            throw new HttpFailure(422, 'JOURNEY_INVALID', 'История просмотра содержит некорректный адрес.');
        }
        return $path;
    }

    private static function timestamp(mixed $value, string $name): string
    {
        $text = self::text($value, 50, $name);
        if (preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/D', $text) !== 1) {
            throw new HttpFailure(422, 'TIMESTAMP_INVALID', "Некорректное поле {$name}.");
        }
        try {
            $date = new DateTimeImmutable($text);
        } catch (Throwable) {
            throw new HttpFailure(422, 'TIMESTAMP_INVALID', "Некорректное поле {$name}.");
        }
        $parseErrors = DateTimeImmutable::getLastErrors();
        if (is_array($parseErrors) && ((int)$parseErrors['warning_count'] > 0 || (int)$parseErrors['error_count'] > 0)) {
            throw new HttpFailure(422, 'TIMESTAMP_INVALID', "Некорректное поле {$name}.");
        }
        return $date->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z');
    }

    /** @param array<string,mixed> $settings */
    private static function minimizedReferrer(string $url, array $settings): string
    {
        if ($url === '') {
            return '';
        }
        $parts = parse_url($url);
        if (!is_array($parts)) {
            return '';
        }
        $scheme = strtolower((string)($parts['scheme'] ?? ''));
        $host = strtolower((string)($parts['host'] ?? ''));
        if (!in_array($scheme, ['http', 'https'], true) || $host === '') {
            return '';
        }
        if (in_array($host, $settings['allowed_hosts'], true)) {
            return '/' . ltrim((string)preg_replace('~/+~', '/', (string)($parts['path'] ?? '/')), '/');
        }
        return $scheme . '://' . $host;
    }

    /** @param array<string,mixed> $settings */
    private static function sameSitePath(string $url, array $settings, ?string $requiredPath = null): string
    {
        $parts = parse_url($url);
        if (!is_array($parts)
            || strtolower((string)($parts['scheme'] ?? '')) !== 'https'
            || !in_array(strtolower((string)($parts['host'] ?? '')), $settings['allowed_hosts'], true)
            || (isset($parts['port']) && $parts['port'] !== 443)
            || isset($parts['user'])
            || isset($parts['pass'])
        ) {
            throw new HttpFailure(422, 'URL_INVALID', 'Ссылка должна относиться к текущему сайту.');
        }
        $path = (string)($parts['path'] ?? '/');
        $path = '/' . ltrim((string)preg_replace('~/+~', '/', $path), '/');
        if ($requiredPath !== null && rtrim($path, '/') . '/' !== rtrim($requiredPath, '/') . '/') {
            throw new HttpFailure(422, 'CONSENT_URL_INVALID', 'Некорректная ссылка на согласие.');
        }
        return $path;
    }
}

final class CustomerIdentity
{
    private const KEY_DOMAIN = "egoe/customer-history-key/v1";
    private const VALUE_DOMAIN = "egoe/customer-history-identity/v1";

    /** @param array<string,mixed> $fields
     *  @return array<string,string> fingerprint => identity kind
     */
    public static function fingerprints(array $fields, string $masterKey): array
    {
        if (strlen($masterKey) < 32) {
            throw new RuntimeException('Customer history hash key is unavailable');
        }
        $derivedKey = hash_hmac('sha256', self::KEY_DOMAIN, $masterKey, true);
        $fingerprints = [];
        foreach ($fields as $fieldName => $fieldValue) {
            if (!is_string($fieldName) || !is_string($fieldValue) || trim($fieldValue) === '') {
                continue;
            }
            $kind = null;
            $normalized = null;
            if (preg_match('/тел|phone/iu', $fieldName) === 1) {
                $kind = 'phone';
                $normalized = self::phone($fieldValue);
            } elseif (preg_match('/почт|e-?mail/iu', $fieldName) === 1) {
                $kind = 'email';
                $normalized = self::email($fieldValue);
            }
            if ($kind === null || $normalized === null) {
                continue;
            }
            $message = self::VALUE_DOMAIN . "\0" . $kind . "\0" . $normalized;
            $fingerprints[$kind . ':' . hash_hmac('sha256', $message, $derivedKey)] = $kind;
        }
        ksort($fingerprints, SORT_STRING);
        return $fingerprints;
    }

    private static function phone(string $value): ?string
    {
        $digits = preg_replace('/\D+/', '', $value) ?? '';
        if (strlen($digits) === 10) {
            $digits = '7' . $digits;
        } elseif (strlen($digits) === 11 && $digits[0] === '8') {
            $digits = '7' . substr($digits, 1);
        }
        return strlen($digits) === 11 && $digits[0] === '7' ? '+' . $digits : null;
    }

    private static function email(string $value): ?string
    {
        $normalized = mb_strtolower(trim($value), 'UTF-8');
        return filter_var($normalized, FILTER_VALIDATE_EMAIL) !== false ? $normalized : null;
    }
}

final class CustomerHistory
{
    public const SCAN_LIMIT = 5000;
    public const ENTRY_LIMIT = 50;
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/Di';

    /** @return array<string,mixed> */
    public static function forLead(PDO $pdo, string $leadId, string $masterKey): array
    {
        $leadId = strtolower(trim($leadId));
        if (preg_match(self::UUID, $leadId) !== 1) {
            throw new RuntimeException('Lead ID must be a UUID');
        }
        $targetQuery = $pdo->prepare(<<<'SQL'
SELECT lead_id, received_at, form_id, page_path, fields_json, payload_json
FROM leads
WHERE lead_id = :lead_id
SQL);
        $targetQuery->execute([':lead_id' => $leadId]);
        $target = $targetQuery->fetch();
        if (!is_array($target)) {
            throw new RuntimeException('Lead not found');
        }
        $targetFields = self::decodeFields((string)$target['fields_json']);
        $targetFingerprints = CustomerIdentity::fingerprints($targetFields, $masterKey);
        if ($targetFingerprints === []) {
            throw new RuntimeException('Lead has no usable customer identity');
        }

        $totalRetained = (int)$pdo->query('SELECT count(*) FROM leads')->fetchColumn();
        $matches = [self::entry($target, $targetFields)];
        $matchedKinds = [];
        $scanned = 1;

        $scan = $pdo->prepare(<<<'SQL'
SELECT lead_id, received_at, form_id, page_path, fields_json, payload_json
FROM leads
WHERE lead_id <> :lead_id
ORDER BY received_at DESC, lead_id DESC
LIMIT :limit
SQL);
        $scan->bindValue(':lead_id', $leadId, PDO::PARAM_STR);
        $scan->bindValue(':limit', self::SCAN_LIMIT - 1, PDO::PARAM_INT);
        $scan->execute();
        while (($row = $scan->fetch()) !== false) {
            $scanned += 1;
            try {
                $fields = self::decodeFields((string)$row['fields_json']);
            } catch (RuntimeException) {
                continue;
            }
            $candidateFingerprints = CustomerIdentity::fingerprints($fields, $masterKey);
            $shared = array_intersect_key($candidateFingerprints, $targetFingerprints);
            if ($shared === []) {
                continue;
            }
            foreach ($shared as $kind) {
                $matchedKinds[$kind] = true;
            }
            $matches[] = self::entry($row, $fields);
        }

        usort($matches, static function (array $left, array $right): int {
            return [$left['receivedAt'], $left['leadId']] <=> [$right['receivedAt'], $right['leadId']];
        });
        $matchingLeadCount = count($matches);
        $returned = array_slice($matches, -self::ENTRY_LIMIT);
        $knownAmountRub = 0;
        $quoteCount = 0;
        foreach ($matches as $entry) {
            if (is_int($entry['amountRub'])) {
                $knownAmountRub += $entry['amountRub'];
            }
            if (is_string($entry['kpNumber'])) {
                $quoteCount += 1;
            }
        }
        ksort($matchedKinds, SORT_STRING);

        return [
            'leadId' => $leadId,
            'limits' => ['scan' => self::SCAN_LIMIT, 'entries' => self::ENTRY_LIMIT],
            'scan' => [
                'retainedLeadCount' => $totalRetained,
                'scannedLeadCount' => $scanned,
                'truncated' => $totalRetained > $scanned,
            ],
            'summary' => [
                'matchingLeadCount' => $matchingLeadCount,
                'returnedLeadCount' => count($returned),
                'entriesTruncated' => $matchingLeadCount > count($returned),
                'matchedBy' => array_keys($matchedKinds),
                'firstReceivedAt' => $matches[0]['receivedAt'],
                'lastReceivedAt' => $matches[$matchingLeadCount - 1]['receivedAt'],
                'quoteCount' => $quoteCount,
                'knownAmountRub' => $knownAmountRub,
            ],
            'entries' => $returned,
        ];
    }

    /** @return array<string,mixed> */
    private static function decodeFields(string $json): array
    {
        try {
            $fields = json_decode($json, true, 32, JSON_THROW_ON_ERROR);
        } catch (JsonException $error) {
            throw new RuntimeException('Lead fields are unreadable', 0, $error);
        }
        if (!is_array($fields) || array_is_list($fields)) {
            throw new RuntimeException('Lead fields are unreadable');
        }
        return $fields;
    }

    /** @param array<string,mixed> $row
     *  @param array<string,mixed> $fields
     *  @return array{leadId:string,receivedAt:string,formId:string,pagePath:string,amountRub:?int,kpNumber:?string,viewed:list<array{path:string,title:string,viewedAt:string}>}
     */
    private static function entry(array $row, array $fields): array
    {
        [$amountRub, $kpNumber] = self::orderDetails($fields);
        return [
            'leadId' => (string)$row['lead_id'],
            'receivedAt' => (string)$row['received_at'],
            'formId' => (string)$row['form_id'],
            'pagePath' => (string)$row['page_path'],
            'amountRub' => $amountRub,
            'kpNumber' => $kpNumber,
            'viewed' => self::safeJourney((string)$row['payload_json']),
        ];
    }

    /** @param array<string,mixed> $fields
     *  @return array{0:?int,1:?string}
     */
    private static function orderDetails(array $fields): array
    {
        $amountRub = null;
        $kpNumber = null;
        foreach ($fields as $name => $value) {
            if (!is_string($name) || !is_string($value)) {
                continue;
            }
            $key = mb_strtolower(trim((string)preg_replace('/\s+/u', ' ', $name)), 'UTF-8');
            if ($amountRub === null && preg_match('/^(?:итого|сумма(?: (?:заказа|кп))?|total)$/uD', $key) === 1) {
                $amountRub = self::rubles($value);
            }
            if ($kpNumber === null && preg_match('/^(?:№ ?кп|номер кп|кп)$/uD', $key) === 1) {
                $candidate = trim((string)preg_replace('/[\x00-\x1F\x7F]/u', '', $value));
                if ($candidate !== '' && mb_strlen($candidate, 'UTF-8') <= 100) {
                    $kpNumber = $candidate;
                }
            }
        }
        return [$amountRub, $kpNumber];
    }

    private static function rubles(string $value): ?int
    {
        if (preg_match('/^\s*(\d[\d\s\x{00A0}]*)(?:[,.]00)?\s*(?:₽|руб\.?)?\s*$/uD', $value, $match) !== 1) {
            return null;
        }
        $digits = preg_replace('/\D+/', '', $match[1]) ?? '';
        if ($digits === '' || strlen($digits) > 12) {
            return null;
        }
        $amount = (int)$digits;
        return $amount <= 100000000000 ? $amount : null;
    }

    /** @return list<array{path:string,title:string,viewedAt:string}> */
    private static function safeJourney(string $payloadJson): array
    {
        try {
            $payload = json_decode($payloadJson, true, 32, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return [];
        }
        $journey = is_array($payload) ? ($payload['journey'] ?? null) : null;
        if (!is_array($journey) || !array_is_list($journey)) {
            return [];
        }
        $safe = [];
        foreach (array_slice($journey, 0, 20) as $entry) {
            if (!is_array($entry)
                || array_is_list($entry)
                || !is_string($entry['path'] ?? null)
                || !is_string($entry['title'] ?? null)
                || !is_string($entry['viewedAt'] ?? null)
                || !str_starts_with($entry['path'], '/')
                || str_starts_with($entry['path'], '//')
                || str_contains($entry['path'], '?')
                || str_contains($entry['path'], '#')
                || mb_strlen($entry['path'], 'UTF-8') > 500
                || mb_strlen($entry['title'], 'UTF-8') > 160
                || preg_match('/^\d{4}-\d{2}-\d{2}T/uD', $entry['viewedAt']) !== 1
            ) {
                continue;
            }
            $safe[] = [
                'path' => $entry['path'],
                'title' => preg_replace('/\s+/u', ' ', trim($entry['title'])) ?? '',
                'viewedAt' => $entry['viewedAt'],
            ];
        }
        return $safe;
    }
}

interface OutboxTransport
{
    public function enabled(): bool;

    public function mode(): string;

    /** @param array<string,mixed> $lead
     *  @return array<string,mixed>
     */
    public function payload(array $lead): array;

    public function deliver(PDO $pdo, string $leadId, string $payloadJson): void;
}

final class LeadStore
{
    /** @param array<string,mixed> $lead
     *  @param array<string,mixed> $settings
     *  @return array{duplicate:bool,outboxId:?int}
     */
    public static function accept(
        PDO $pdo,
        array $lead,
        array $settings,
        string $ipHash,
        ?OutboxTransport $transport = null
    ): array
    {
        $transport ??= Relay::transport($settings);
        $payloadJson = self::json($lead);
        $hashPayload = [
            'formId' => $lead['formId'],
            'tag' => $lead['tag'],
            'page' => $lead['page'],
            'consent' => [
                'version' => $lead['consent']['version'],
                'documentUrl' => $lead['consent']['documentUrl'],
            ],
            'fields' => $lead['fields'],
        ];
        // Preserve the pre-journey idempotency hash for cached clients retrying an accepted request.
        if ($lead['journey'] !== []) {
            $hashPayload['journey'] = $lead['journey'];
        }
        $payloadHash = hash('sha256', self::json(self::canonicalize($hashPayload)));
        $pdo->exec('BEGIN IMMEDIATE');
        try {
            $existing = $pdo->prepare('SELECT payload_hash FROM leads WHERE lead_id = :lead_id');
            $existing->execute([':lead_id' => $lead['leadId']]);
            $row = $existing->fetch();
            if (is_array($row)) {
                if (!hash_equals((string)$row['payload_hash'], $payloadHash)) {
                    throw new HttpFailure(409, 'IDEMPOTENCY_CONFLICT', 'Номер заявки уже использован с другими данными.');
                }
                $pdo->exec('COMMIT');
                return ['duplicate' => true, 'outboxId' => null];
            }

            self::consumeRateLimit($pdo, $settings, $ipHash);
            $receivedAt = Runtime::utcNow();
            $statement = $pdo->prepare(<<<'SQL'
INSERT INTO leads (
  lead_id, payload_hash, form_id, tag, created_at, received_at, page_path, page_title,
  page_referrer, consent_version, consent_accepted_at, consent_document_url,
  fields_json, payload_json, ip_hash
) VALUES (
  :lead_id, :payload_hash, :form_id, :tag, :created_at, :received_at, :page_path, :page_title,
  :page_referrer, :consent_version, :consent_accepted_at, :consent_document_url,
  :fields_json, :payload_json, :ip_hash
)
SQL);
            $statement->execute([
                ':lead_id' => $lead['leadId'],
                ':payload_hash' => $payloadHash,
                ':form_id' => $lead['formId'],
                ':tag' => $lead['tag'],
                ':created_at' => $lead['createdAt'],
                ':received_at' => $receivedAt,
                ':page_path' => $lead['page']['path'],
                ':page_title' => $lead['page']['title'],
                ':page_referrer' => $lead['page']['referrer'],
                ':consent_version' => $lead['consent']['version'],
                ':consent_accepted_at' => $lead['consent']['acceptedAt'],
                ':consent_document_url' => $lead['consent']['documentUrl'],
                ':fields_json' => self::json($lead['fields']),
                ':payload_json' => $payloadJson,
                ':ip_hash' => $ipHash,
            ]);

            $evidence = $pdo->prepare(<<<'SQL'
INSERT INTO consent_evidence (
  lead_id, payload_hash, form_id, page_path, consent_version, consent_accepted_at, consent_document_url, received_at
) VALUES (
  :lead_id, :payload_hash, :form_id, :page_path, :consent_version, :consent_accepted_at, :consent_document_url, :received_at
)
SQL);
            $evidence->execute([
                ':lead_id' => $lead['leadId'],
                ':payload_hash' => $payloadHash,
                ':form_id' => $lead['formId'],
                ':page_path' => $lead['page']['path'],
                ':consent_version' => $lead['consent']['version'],
                ':consent_accepted_at' => $lead['consent']['acceptedAt'],
                ':consent_document_url' => $lead['consent']['documentUrl'],
                ':received_at' => $receivedAt,
            ]);

            $outboxId = null;
            if ($transport->enabled()
                && Settings::isCurrentConsentVersion((string)($lead['consent']['version'] ?? ''))
            ) {
                $deliveryPayload = $transport->payload($lead);
                $outbox = $pdo->prepare(<<<'SQL'
INSERT INTO outbox (lead_id, mode, payload_json, next_attempt_at, created_at)
VALUES (:lead_id, :mode, :payload_json, :next_attempt_at, :created_at)
SQL);
                $outbox->execute([
                    ':lead_id' => $lead['leadId'],
                    ':mode' => $transport->mode(),
                    ':payload_json' => self::json($deliveryPayload),
                    ':next_attempt_at' => $receivedAt,
                    ':created_at' => $receivedAt,
                ]);
                $outboxId = (int)$pdo->lastInsertId();
            }
            $pdo->exec('COMMIT');
            return ['duplicate' => false, 'outboxId' => $outboxId];
        } catch (Throwable $error) {
            try {
                $pdo->exec('ROLLBACK');
            } catch (Throwable) {
                // Transaction may already be closed by SQLite after a fatal statement.
            }
            throw $error;
        }
    }

    /** @param array<string,mixed> $settings */
    private static function consumeRateLimit(PDO $pdo, array $settings, string $ipHash): void
    {
        $now = time();
        $window = (int)$settings['rate_limit']['window_seconds'];
        $max = (int)$settings['rate_limit']['max_requests'];
        $pdo->prepare('DELETE FROM rate_limits WHERE window_started_at < :cutoff')->execute([':cutoff' => $now - ($window * 2)]);
        $query = $pdo->prepare('SELECT window_started_at, request_count FROM rate_limits WHERE ip_hash = :ip_hash');
        $query->execute([':ip_hash' => $ipHash]);
        $row = $query->fetch();
        if (!is_array($row) || $now - (int)$row['window_started_at'] >= $window) {
            $upsert = $pdo->prepare(<<<'SQL'
INSERT INTO rate_limits (ip_hash, window_started_at, request_count) VALUES (:ip_hash, :started, 1)
ON CONFLICT(ip_hash) DO UPDATE SET window_started_at = excluded.window_started_at, request_count = 1
SQL);
            $upsert->execute([':ip_hash' => $ipHash, ':started' => $now]);
            return;
        }
        if ((int)$row['request_count'] >= $max) {
            throw new HttpFailure(429, 'RATE_LIMITED', 'Слишком много запросов. Повторите позднее.');
        }
        $pdo->prepare('UPDATE rate_limits SET request_count = request_count + 1 WHERE ip_hash = :ip_hash')
            ->execute([':ip_hash' => $ipHash]);
    }

    private static function json(mixed $value): string
    {
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private static function canonicalize(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }
        if (array_is_list($value)) {
            return array_map(self::canonicalize(...), $value);
        }
        ksort($value, SORT_STRING);
        foreach ($value as $key => $item) {
            $value[$key] = self::canonicalize($item);
        }
        return $value;
    }
}

final class RelayTransport implements OutboxTransport
{
    /** @param array<string,mixed> $settings */
    public function __construct(private readonly array $settings)
    {
    }

    public function enabled(): bool
    {
        return ($this->settings['enabled'] ?? false) === true;
    }

    public function mode(): string
    {
        return (string)($this->settings['mode'] ?? 'signal');
    }

    public function payload(array $lead): array
    {
        return Relay::payload($lead, $this->settings);
    }

    public function deliver(PDO $pdo, string $leadId, string $payloadJson): void
    {
        Relay::deliver($this->settings, $payloadJson);
    }
}

final class Outbox
{
    /** @param array<string,mixed> $settings */
    public static function selectTransport(array $settings, ?OutboxTransport $preferred = null): OutboxTransport
    {
        $relay = Relay::transport($settings);
        if ($preferred === null || !$preferred->enabled()) {
            return $relay;
        }
        if ($relay->enabled()) {
            throw new RuntimeException('Only one external lead transport may be enabled');
        }
        return $preferred;
    }

    /** @return array{sent:int,failed:int} */
    public static function retry(PDO $pdo, OutboxTransport $transport, int $limit = 20, ?int $onlyId = null): array
    {
        if (!$transport->enabled()) {
            return ['sent' => 0, 'failed' => 0];
        }
        $pdo->prepare(<<<'SQL'
DELETE FROM outbox
WHERE lead_id IN (
  SELECT lead_id FROM leads WHERE consent_version <> :current_consent_version
)
SQL)->execute([':current_consent_version' => Settings::CURRENT_CONSENT_VERSION]);
        $mode = $transport->mode();
        if (preg_match('/\A[a-z][a-z0-9_-]{0,31}\z/D', $mode) !== 1) {
            throw new RuntimeException('Outbox transport mode is invalid');
        }
        $limit = max(1, min(100, $limit));
        $now = Runtime::utcNow();
        $pdo->prepare("UPDATE outbox SET status = 'failed', last_error = 'stale_claim' WHERE mode = :mode AND status = 'sending' AND next_attempt_at <= :now")
            ->execute([':mode' => $mode, ':now' => $now]);
        $sql = "SELECT outbox.id, outbox.lead_id, outbox.payload_json, outbox.attempts FROM outbox JOIN leads ON leads.lead_id = outbox.lead_id WHERE outbox.mode = :mode AND outbox.status IN ('pending','failed') AND outbox.next_attempt_at <= :now AND leads.consent_version = :current_consent_version";
        $params = [
            ':mode' => $mode,
            ':now' => $now,
            ':current_consent_version' => Settings::CURRENT_CONSENT_VERSION,
        ];
        if ($onlyId !== null) {
            $sql .= ' AND outbox.id = :id';
            $params[':id'] = $onlyId;
        }
        $sql .= ' ORDER BY outbox.id ASC LIMIT ' . $limit;
        $query = $pdo->prepare($sql);
        $query->execute($params);
        $rows = $query->fetchAll();
        $result = ['sent' => 0, 'failed' => 0];
        foreach ($rows as $row) {
            $id = (int)$row['id'];
            $lease = (new DateTimeImmutable('now', new DateTimeZone('UTC')))
                ->modify('+5 minutes')
                ->format('Y-m-d\TH:i:s.v\Z');
            $claim = $pdo->prepare("UPDATE outbox SET status = 'sending', attempts = attempts + 1, next_attempt_at = :lease WHERE id = :id AND mode = :mode AND status IN ('pending','failed') AND EXISTS (SELECT 1 FROM leads WHERE leads.lead_id = outbox.lead_id AND leads.consent_version = :current_consent_version)");
            $claim->execute([
                ':lease' => $lease,
                ':id' => $id,
                ':mode' => $mode,
                ':current_consent_version' => Settings::CURRENT_CONSENT_VERSION,
            ]);
            if ($claim->rowCount() !== 1) {
                continue;
            }
            try {
                $transport->deliver($pdo, (string)$row['lead_id'], (string)$row['payload_json']);
                $pdo->prepare("UPDATE outbox SET status = 'sent', sent_at = :now, last_error = '' WHERE id = :id AND status = 'sending'")
                    ->execute([':now' => Runtime::utcNow(), ':id' => $id]);
                $result['sent'] += 1;
            } catch (Throwable) {
                $attempts = (int)$row['attempts'] + 1;
                $delay = min(3600, 30 * (2 ** min(7, $attempts - 1)));
                $next = (new DateTimeImmutable('now', new DateTimeZone('UTC')))
                    ->modify("+{$delay} seconds")
                    ->format('Y-m-d\TH:i:s.v\Z');
                $pdo->prepare("UPDATE outbox SET status = 'failed', next_attempt_at = :next, last_error = 'delivery_failed' WHERE id = :id AND status = 'sending'")
                    ->execute([':next' => $next, ':id' => $id]);
                $result['failed'] += 1;
            }
        }
        return $result;
    }
}

final class Relay
{
    /** @param array<string,mixed> $lead
     *  @param array<string,mixed> $relay
     *  @return array<string,mixed>
     */
    public static function payload(array $lead, array $relay): array
    {
        $mode = (string)$relay['mode'];
        if ($mode === 'signal') {
            return [
                '_subject' => 'Новая заявка на сайте EGOE',
                'Сообщение' => 'Заявка сохранена в российской базе',
            ];
        }
        if ($mode === 'technical') {
            return [
                '_subject' => 'Новая заявка на сайте EGOE',
                'ID заявки' => $lead['leadId'],
                'Форма' => $lead['formId'],
                'Страница' => $lead['page']['path'],
                'Время' => $lead['createdAt'],
            ];
        }
        if ($mode !== 'full') {
            throw new RuntimeException('Unsupported relay mode');
        }
        $payload = [
            '_subject' => 'Заявка с сайта EGOE — ' . $lead['tag'],
            '_source' => $lead['page']['path'],
        ];
        foreach ($lead['fields'] as $key => $value) {
            if (!array_key_exists($key, $payload)) {
                $payload[$key] = $value;
            }
        }
        return $payload;
    }

    /** @param array<string,mixed> $settings */
    public static function transport(array $settings): OutboxTransport
    {
        $relay = is_array($settings['relay'] ?? null) ? $settings['relay'] : ['enabled' => false];
        return new RelayTransport($relay);
    }

    /** @param array<string,mixed> $settings
     *  @return array{sent:int,failed:int}
     */
    public static function retry(PDO $pdo, array $settings, int $limit = 20, ?int $onlyId = null): array
    {
        return Outbox::retry($pdo, self::transport($settings), $limit, $onlyId);
    }

    /** @param array<string,mixed> $relay */
    public static function deliver(array $relay, string $body): void
    {
        $url = (string)$relay['url'];
        $timeout = (int)$relay['timeout_seconds'];
        $handle = curl_init($url);
        if ($handle === false) {
            throw new RuntimeException('Unable to initialize relay request');
        }
        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => false,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_CONNECTTIMEOUT => min(2, max(1, $timeout)),
            CURLOPT_TIMEOUT => max(1, min(10, $timeout)),
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_USERAGENT => 'EGOE-Lead-Outbox/1.0',
        ]);
        if (($relay['ca_file'] ?? '') !== '') {
            curl_setopt($handle, CURLOPT_CAINFO, (string)$relay['ca_file']);
        }
        $response = curl_exec($handle);
        $status = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $error = curl_errno($handle);
        curl_close($handle);
        if ($response === false || $error !== 0 || $status < 200 || $status >= 300) {
            throw new RuntimeException('Relay delivery failed');
        }
        if (($relay['require_json_ok'] ?? true) === true) {
            try {
                $decoded = json_decode((string)$response, true, 8, JSON_THROW_ON_ERROR);
            } catch (JsonException) {
                throw new RuntimeException('Relay delivery failed');
            }
            if (!is_array($decoded) || ($decoded['ok'] ?? null) !== true) {
                throw new RuntimeException('Relay delivery failed');
            }
        }
    }
}

final class Endpoint
{
    /** @param array<string,mixed> $server
     *  @return array{status:int,body:array{enabled:bool}}
     */
    public static function status(array $server): array
    {
        if (($server['REQUEST_METHOD'] ?? '') !== 'GET') {
            throw new HttpFailure(405, 'METHOD_NOT_ALLOWED', 'Метод не поддерживается.');
        }
        $root = Runtime::deployRoot();
        $settings = Settings::load($root);
        Validator::assertRequestHost($settings, $server);
        return ['status' => 200, 'body' => ['enabled' => $settings['collection_enabled'] === true]];
    }

    /** @param array<string,mixed> $server
     *  @param array<string,mixed> $post
     *  @param array<string,mixed> $files
     *  @return array{status:int,body:array<string,mixed>}
     */
    public static function handle(
        array $server,
        array $post,
        array $files,
        ?OutboxTransport $preferredTransport = null
    ): array
    {
        if (($server['REQUEST_METHOD'] ?? '') !== 'POST') {
            throw new HttpFailure(405, 'METHOD_NOT_ALLOWED', 'Метод не поддерживается.');
        }
        $root = Runtime::deployRoot();
        $settings = Settings::load($root);
        Validator::assertRequestHost($settings, $server);
        if ($settings['collection_enabled'] !== true) {
            throw new HttpFailure(
                503,
                'COLLECTION_DISABLED',
                'Приём заявок на сайте временно недоступен. Позвоните нам или напишите в WhatsApp.'
            );
        }
        $length = (int)($server['CONTENT_LENGTH'] ?? 0);
        if ($length < 1 || $length > 65536) {
            throw new HttpFailure(413, 'REQUEST_TOO_LARGE', 'Размер запроса недопустим.');
        }
        if (!str_starts_with(strtolower((string)($server['CONTENT_TYPE'] ?? '')), 'multipart/form-data;')) {
            throw new HttpFailure(415, 'CONTENT_TYPE_INVALID', 'Ожидаются данные формы.');
        }
        if (array_diff(array_keys($post), ['payload']) !== [] || !isset($post['payload']) || !is_string($post['payload'])) {
            throw new HttpFailure(422, 'PAYLOAD_REQUIRED', 'Данные заявки отсутствуют.');
        }
        foreach ($files as $file) {
            if (is_array($file) && (int)($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_NO_FILE) {
                throw new HttpFailure(422, 'ATTACHMENTS_DISABLED', 'Вложения временно отключены.');
            }
        }
        Validator::assertRequestProvenance($settings, $server);
        try {
            $decoded = json_decode($post['payload'], true, 32, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new HttpFailure(422, 'JSON_INVALID', 'Некорректные данные заявки.');
        }
        if (!is_array($decoded) || array_is_list($decoded)) {
            throw new HttpFailure(422, 'JSON_INVALID', 'Некорректные данные заявки.');
        }
        $lead = Validator::payload($decoded, $settings);
        if ($lead['spamCheck']['website'] !== '') {
            return ['status' => 200, 'body' => ['ok' => true, 'leadId' => $lead['leadId'], 'filtered' => true]];
        }
        if ($lead['spamCheck']['elapsedMs'] < $settings['minimum_elapsed_ms']) {
            throw new HttpFailure(422, 'TOO_FAST', 'Форма отправлена слишком быстро. Повторите попытку.');
        }
        $ip = (string)($server['REMOTE_ADDR'] ?? 'unknown');
        $ipHash = hash_hmac('sha256', $ip, (string)$settings['ip_hash_key']);
        unset($ip);

        $pdo = Database::connect($root);
        $transport = Outbox::selectTransport($settings, $preferredTransport);
        $accepted = LeadStore::accept($pdo, $lead, $settings, $ipHash, $transport);
        if ($accepted['outboxId'] !== null) {
            try {
                Outbox::retry($pdo, $transport, 1, $accepted['outboxId']);
            } catch (Throwable) {
                // SQLite is authoritative. Delivery availability never reverses acceptance.
            }
        }
        return [
            'status' => $accepted['duplicate'] ? 200 : 201,
            'body' => ['ok' => true, 'leadId' => $lead['leadId'], 'duplicate' => $accepted['duplicate']],
        ];
    }
}
