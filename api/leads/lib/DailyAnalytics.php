<?php

declare(strict_types=1);

namespace Egoe\Analytics;

use DateTimeImmutable;
use DateTimeZone;
use JsonException;
use RuntimeException;
use SQLite3;
use SQLite3Result;
use Throwable;

final class AnalyticsFailure extends RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        string $message
    ) {
        parent::__construct($message);
    }
}

final class ReportWindow
{
    public function __construct(
        public readonly string $date,
        public readonly DateTimeZone $timezone,
        public readonly DateTimeImmutable $startUtc,
        public readonly DateTimeImmutable $endUtc
    ) {
    }

    public static function forDate(?string $requestedDate, string $timezoneName): self
    {
        try {
            $timezone = new DateTimeZone($timezoneName);
        } catch (Throwable) {
            throw new AnalyticsFailure('timezone_invalid', 'Configured report timezone is invalid');
        }

        if ($requestedDate === null) {
            $date = (new DateTimeImmutable('now', $timezone))->modify('-1 day')->format('Y-m-d');
        } else {
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/D', $requestedDate) !== 1) {
                throw new AnalyticsFailure('date_invalid', 'Report date must use YYYY-MM-DD');
            }
            $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $requestedDate, $timezone);
            $errors = DateTimeImmutable::getLastErrors();
            if (!$parsed instanceof DateTimeImmutable
                || (is_array($errors) && (($errors['warning_count'] ?? 0) > 0 || ($errors['error_count'] ?? 0) > 0))
                || $parsed->format('Y-m-d') !== $requestedDate
            ) {
                throw new AnalyticsFailure('date_invalid', 'Report date is not a real calendar date');
            }
            $date = $requestedDate;
        }

        $start = new DateTimeImmutable($date . ' 00:00:00', $timezone);
        $utc = new DateTimeZone('UTC');
        return new self($date, $timezone, $start->setTimezone($utc), $start->modify('+1 day')->setTimezone($utc));
    }

    public function startIso(): string
    {
        return $this->startUtc->format('Y-m-d\TH:i:s.v\Z');
    }

    public function endIso(): string
    {
        return $this->endUtc->format('Y-m-d\TH:i:s.v\Z');
    }

    public function previousStartIso(): string
    {
        return $this->startUtc
            ->setTimezone($this->timezone)
            ->modify('-1 day')
            ->setTimezone(new DateTimeZone('UTC'))
            ->format('Y-m-d\TH:i:s.v\Z');
    }
}

final class Settings
{
    /** @return array<string,mixed> */
    public static function load(string $path): array
    {
        $real = realpath($path);
        if (!is_string($real) || !is_file($real) || is_link($path) || !is_readable($real)) {
            throw new AnalyticsFailure('config_unavailable', 'Analytics configuration is unavailable');
        }
        $permissions = fileperms($real);
        if ($permissions === false || ($permissions & 0777) !== 0600) {
            throw new AnalyticsFailure('config_permissions', 'Analytics configuration permissions must be 0600');
        }
        if (function_exists('posix_geteuid')) {
            $owner = fileowner($real);
            if ($owner === false || $owner !== posix_geteuid()) {
                throw new AnalyticsFailure('config_owner', 'Analytics configuration must belong to the runtime user');
            }
        }

        $loaded = require $real;
        if (!is_array($loaded)) {
            throw new AnalyticsFailure('config_invalid', 'Analytics configuration must return an array');
        }

        $settings = array_replace_recursive(self::defaults(), $loaded);
        self::validate($settings);
        return $settings;
    }

    /** @return array<string,mixed> */
    private static function defaults(): array
    {
        return [
            'timezone' => 'Europe/Moscow',
            'leads' => [
                'source' => 'sqlite',
                'sqlite_path' => '',
                'json_path' => '',
            ],
            'privacy' => [
                'minimum_reportable_count' => 1,
            ],
            'yandex_webmaster' => [
                'enabled' => false,
                'oauth_token' => '',
                'oauth_token_env' => 'EGOE_YANDEX_WEBMASTER_TOKEN',
                'api_base_url' => 'https://api.webmaster.yandex.net/v4',
                'site_urls' => ['https://www.egoe-life.ru/', 'https://egoe-life.ru/'],
                'host_id' => '',
                'timeout_seconds' => 10,
            ],
            'delivery' => [
                'enabled' => false,
                'url' => '',
                'url_sha256' => '',
                'receipts_dir' => '',
                'timeout_seconds' => 10,
            ],
        ];
    }

    /** @param array<string,mixed> $settings */
    private static function validate(array $settings): void
    {
        try {
            new DateTimeZone((string)$settings['timezone']);
        } catch (Throwable) {
            throw new AnalyticsFailure('config_timezone', 'Configured report timezone is invalid');
        }

        $source = $settings['leads']['source'] ?? null;
        if (!in_array($source, ['sqlite', 'json'], true)) {
            throw new AnalyticsFailure('config_source', 'Lead source must be sqlite or json');
        }
        $minimum = $settings['privacy']['minimum_reportable_count'] ?? null;
        if (!is_int($minimum) || $minimum < 1 || $minimum > 100) {
            throw new AnalyticsFailure('config_privacy', 'minimum_reportable_count must be an integer from 1 to 100');
        }

        $webmaster = $settings['yandex_webmaster'] ?? null;
        if (!is_array($webmaster) || !is_bool($webmaster['enabled'] ?? null)) {
            throw new AnalyticsFailure('config_yandex', 'Yandex Webmaster enabled must be boolean');
        }
        $timeout = $webmaster['timeout_seconds'] ?? null;
        if (!is_int($timeout) || $timeout < 1 || $timeout > 30) {
            throw new AnalyticsFailure('config_yandex_timeout', 'Yandex Webmaster timeout must be an integer from 1 to 30');
        }
        $tokenEnv = $webmaster['oauth_token_env'] ?? '';
        if (!is_string($tokenEnv) || ($tokenEnv !== '' && preg_match('/^[A-Z][A-Z0-9_]{1,63}$/D', $tokenEnv) !== 1)) {
            throw new AnalyticsFailure('config_yandex_token_env', 'Yandex Webmaster token environment name is invalid');
        }
        if (!is_string($webmaster['oauth_token'] ?? null)) {
            throw new AnalyticsFailure('config_yandex_token', 'Yandex Webmaster token must be a string');
        }
        $urls = $webmaster['site_urls'] ?? null;
        if (!is_array($urls) || $urls === [] || count($urls) > 10) {
            throw new AnalyticsFailure('config_yandex_sites', 'Yandex Webmaster site_urls must contain 1 to 10 URLs');
        }
        foreach ($urls as $url) {
            if (!is_string($url) || self::normalizeSiteUrl($url) === null) {
                throw new AnalyticsFailure('config_yandex_sites', 'Yandex Webmaster site URL is invalid');
            }
        }
        if (!is_string($webmaster['host_id'] ?? null)) {
            throw new AnalyticsFailure('config_yandex_host', 'Yandex Webmaster host_id must be a string');
        }
        self::assertSafeApiBase((string)($webmaster['api_base_url'] ?? ''));

        $delivery = $settings['delivery'] ?? null;
        if (!is_array($delivery) || !is_bool($delivery['enabled'] ?? null)) {
            throw new AnalyticsFailure('config_delivery', 'Daily delivery enabled must be boolean');
        }
        $deliveryTimeout = $delivery['timeout_seconds'] ?? null;
        if (!is_int($deliveryTimeout) || $deliveryTimeout < 1 || $deliveryTimeout > 30) {
            throw new AnalyticsFailure('config_delivery_timeout', 'Daily delivery timeout must be an integer from 1 to 30');
        }
        foreach (['url', 'url_sha256', 'receipts_dir'] as $field) {
            if (!is_string($delivery[$field] ?? null)) {
                throw new AnalyticsFailure('config_delivery', 'Daily delivery configuration is invalid');
            }
        }
        if ($delivery['enabled'] === true) {
            self::assertSafeDeliveryUrl($delivery['url']);
            if (preg_match('/^[a-f0-9]{64}$/D', $delivery['url_sha256']) !== 1
                || !hash_equals($delivery['url_sha256'], hash('sha256', $delivery['url']))
            ) {
                throw new AnalyticsFailure('delivery_url_hash_invalid', 'Daily delivery URL does not match its approved SHA-256');
            }
            self::assertSafeReceiptsPath($delivery['receipts_dir']);
        }
    }

    public static function resolveWebmasterToken(array $settings): string
    {
        $webmaster = $settings['yandex_webmaster'];
        $envName = (string)$webmaster['oauth_token_env'];
        $fromEnvironment = $envName !== '' ? getenv($envName) : false;
        $token = is_string($fromEnvironment) && $fromEnvironment !== ''
            ? $fromEnvironment
            : (string)$webmaster['oauth_token'];
        if ($token !== '' && (strlen($token) > 4096 || preg_match('/[\x00-\x20\x7f]/', $token) === 1)) {
            throw new AnalyticsFailure('yandex_token_invalid', 'Yandex Webmaster OAuth token has an invalid format');
        }
        return $token;
    }

    public static function assertSafeApiBase(string $baseUrl): void
    {
        if (rtrim($baseUrl, '/') === 'https://api.webmaster.yandex.net/v4') {
            return;
        }
        $testing = getenv('EGOE_ANALYTICS_TESTING') === '1';
        $parts = parse_url($baseUrl);
        $host = is_array($parts) ? strtolower((string)($parts['host'] ?? '')) : '';
        $scheme = is_array($parts) ? strtolower((string)($parts['scheme'] ?? '')) : '';
        if ($testing && $scheme === 'http' && in_array($host, ['127.0.0.1', '::1', 'localhost'], true)) {
            return;
        }
        throw new AnalyticsFailure('yandex_api_base_invalid', 'Yandex Webmaster API base is not allowlisted');
    }

    public static function assertSafeDeliveryUrl(string $url): void
    {
        $parts = parse_url($url);
        if (!is_array($parts)) {
            throw new AnalyticsFailure('delivery_url_invalid', 'Daily delivery URL is invalid');
        }
        $scheme = strtolower((string)($parts['scheme'] ?? ''));
        $host = strtolower((string)($parts['host'] ?? ''));
        $path = (string)($parts['path'] ?? '');
        $production = $scheme === 'https'
            && $host === 'script.google.com'
            && (!isset($parts['port']) || (int)$parts['port'] === 443)
            && preg_match('#^/macros/s/[A-Za-z0-9_-]{20,300}/exec$#D', $path) === 1;
        $testing = getenv('EGOE_ANALYTICS_TESTING') === '1';
        $loopback = $testing
            && $scheme === 'http'
            && in_array($host, ['127.0.0.1', '::1', 'localhost'], true)
            && isset($parts['port']);
        if ((!$production && !$loopback)
            || isset($parts['user']) || isset($parts['pass'])
            || isset($parts['query']) || isset($parts['fragment'])
        ) {
            throw new AnalyticsFailure('delivery_url_invalid', 'Daily delivery URL is not an allowlisted GAS endpoint');
        }
    }

    public static function assertSafeReceiptsPath(string $path): void
    {
        $productionPath = '/var/www/u3602289/data/www/egoe-deploy/shared/analytics/receipts';
        $testing = getenv('EGOE_ANALYTICS_TESTING') === '1';
        if ($path === '' || $path[0] !== '/' || (!$testing && $path !== $productionPath)) {
            throw new AnalyticsFailure('delivery_receipts_invalid', 'Daily delivery receipts path is not allowlisted');
        }
    }

    public static function normalizeSiteUrl(string $url): ?string
    {
        $parts = parse_url($url);
        if (!is_array($parts)) {
            return null;
        }
        $scheme = strtolower((string)($parts['scheme'] ?? ''));
        $host = strtolower(rtrim((string)($parts['host'] ?? ''), '.'));
        if (!in_array($scheme, ['http', 'https'], true)
            || preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/D', $host) !== 1
            || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])
        ) {
            return null;
        }
        $port = isset($parts['port']) ? (int)$parts['port'] : ($scheme === 'https' ? 443 : 80);
        if ($port < 1 || $port > 65535) {
            return null;
        }
        return $scheme . '://' . $host . ':' . $port . '/';
    }
}

/** @return array<string,mixed> */
function emptyLeadSummary(): array
{
    return [
        'total' => 0,
        'kp' => 0,
        'regular' => 0,
        'previous_total' => 0,
        'kp_amount_rub' => null,
        'kp_amount_status' => 'no_data',
        'top_form_counts' => [],
        'top_page_counts' => [],
        'outbox_sent' => 0,
        'outbox_failed' => 0,
        'outbox_pending' => 0,
        'outbox_status' => 'unavailable',
    ];
}

interface LeadSummarySource
{
    /** @return array<string,mixed> */
    public function summarize(ReportWindow $window): array;

    public function label(): string;
}

final class SqliteLeadSummarySource implements LeadSummarySource
{
    public function __construct(private readonly string $path)
    {
    }

    public function label(): string
    {
        return 'sqlite';
    }

    public function summarize(ReportWindow $window): array
    {
        $real = realpath($this->path);
        if (!is_string($real) || !is_file($real) || is_link($this->path) || !is_readable($real)) {
            throw new AnalyticsFailure('sqlite_unavailable', 'Lead SQLite database is unavailable');
        }
        $permissions = fileperms($real);
        if ($permissions === false || ($permissions & 0077) !== 0) {
            throw new AnalyticsFailure('sqlite_permissions', 'Lead SQLite database must not be group/world accessible');
        }
        if (function_exists('posix_geteuid')) {
            $owner = fileowner($real);
            if ($owner === false || $owner !== posix_geteuid()) {
                throw new AnalyticsFailure('sqlite_owner', 'Lead SQLite database must belong to the runtime user');
            }
        }
        if (!extension_loaded('sqlite3') || !class_exists(SQLite3::class)) {
            throw new AnalyticsFailure('sqlite_extension_missing', 'PHP sqlite3 extension is unavailable');
        }

        $database = null;
        try {
            $database = new SQLite3($real, SQLITE3_OPEN_READONLY);
            $database->enableExceptions(true);
            $database->busyTimeout(5000);
            $database->exec('PRAGMA query_only = ON');
            $this->assertSchema($database);
            $statement = $database->prepare(<<<'SQL'
SELECT
  COALESCE(SUM(CASE WHEN received_at >= :start_utc THEN 1 ELSE 0 END), 0) AS total,
  COALESCE(SUM(CASE WHEN received_at >= :start_utc AND form_id = 'cart:quote' THEN 1 ELSE 0 END), 0) AS kp,
  COALESCE(SUM(CASE WHEN received_at < :start_utc THEN 1 ELSE 0 END), 0) AS previous_total
FROM leads
WHERE received_at >= :previous_start_utc AND received_at < :end_utc
SQL);
            if ($statement === false) {
                throw new AnalyticsFailure('sqlite_prepare_failed', 'Unable to prepare the lead summary query');
            }
            $statement->bindValue(':previous_start_utc', $window->previousStartIso(), SQLITE3_TEXT);
            $statement->bindValue(':start_utc', $window->startIso(), SQLITE3_TEXT);
            $statement->bindValue(':end_utc', $window->endIso(), SQLITE3_TEXT);
            $result = $statement->execute();
            if (!$result instanceof SQLite3Result) {
                throw new AnalyticsFailure('sqlite_query_failed', 'Unable to execute the lead summary query');
            }
            $row = $result->fetchArray(SQLITE3_ASSOC);
            $result->finalize();
            if (!is_array($row)) {
                throw new AnalyticsFailure('sqlite_result_invalid', 'Lead summary query returned no row');
            }
            $total = max(0, (int)($row['total'] ?? 0));
            $kp = max(0, min($total, (int)($row['kp'] ?? 0)));
            $summary = emptyLeadSummary();
            $summary['total'] = $total;
            $summary['kp'] = $kp;
            $summary['regular'] = $total - $kp;
            $summary['previous_total'] = max(0, (int)($row['previous_total'] ?? 0));
            [$summary['kp_amount_rub'], $summary['kp_amount_status']] = $this->quoteAmount($database, $window, $kp);
            $summary['top_form_counts'] = $this->topBuckets($database, $window, 'form');
            $summary['top_page_counts'] = $this->topBuckets($database, $window, 'page');
            $summary = array_replace($summary, $this->outboxSummary($database, $window));
            return $summary;
        } catch (AnalyticsFailure $error) {
            throw $error;
        } catch (Throwable $error) {
            throw new AnalyticsFailure('sqlite_read_failed', 'Unable to read the lead SQLite database');
        } finally {
            if ($database instanceof SQLite3) {
                $database->close();
            }
        }
    }

    private function assertSchema(SQLite3 $database): void
    {
        $result = $database->query('PRAGMA table_info(leads)');
        if (!$result instanceof SQLite3Result) {
            throw new AnalyticsFailure('sqlite_schema_invalid', 'Unable to inspect the lead schema');
        }
        $columns = [];
        while (($row = $result->fetchArray(SQLITE3_ASSOC)) !== false) {
            if (is_string($row['name'] ?? null)) {
                $columns[] = $row['name'];
            }
        }
        $result->finalize();
        foreach (['received_at', 'form_id', 'page_path', 'payload_json'] as $required) {
            if (!in_array($required, $columns, true)) {
                throw new AnalyticsFailure('sqlite_schema_invalid', 'Lead SQLite schema is missing required columns');
            }
        }
        $outbox = $database->query('PRAGMA table_info(outbox)');
        if (!$outbox instanceof SQLite3Result) {
            throw new AnalyticsFailure('sqlite_schema_invalid', 'Unable to inspect the outbox schema');
        }
        $outboxColumns = [];
        while (($row = $outbox->fetchArray(SQLITE3_ASSOC)) !== false) {
            if (is_string($row['name'] ?? null)) {
                $outboxColumns[] = $row['name'];
            }
        }
        $outbox->finalize();
        foreach (['status', 'sent_at'] as $required) {
            if (!in_array($required, $outboxColumns, true)) {
                throw new AnalyticsFailure('sqlite_schema_invalid', 'Lead SQLite schema is missing required outbox columns');
            }
        }
    }

    /** @return array{0:int|float|null,1:string} */
    private function quoteAmount(SQLite3 $database, ReportWindow $window, int $expectedQuotes): array
    {
        if ($expectedQuotes === 0) {
            return [0, 'no_data'];
        }
        try {
            $statement = $database->prepare(<<<'SQL'
SELECT CASE
  WHEN json_valid(payload_json) = 1 THEN json_extract(payload_json, '$.fields.Итого')
  ELSE NULL
END AS quote_total
FROM leads
WHERE received_at >= :start_utc AND received_at < :end_utc AND form_id = 'cart:quote'
SQL);
            if ($statement === false) {
                return [null, 'unavailable'];
            }
            $statement->bindValue(':start_utc', $window->startIso(), SQLITE3_TEXT);
            $statement->bindValue(':end_utc', $window->endIso(), SQLITE3_TEXT);
            $result = $statement->execute();
            if (!$result instanceof SQLite3Result) {
                return [null, 'unavailable'];
            }
            $sum = 0.0;
            $parsed = 0;
            while (($row = $result->fetchArray(SQLITE3_ASSOC)) !== false) {
                $amount = MetricTools::rubles($row['quote_total'] ?? null);
                if ($amount !== null) {
                    $sum += $amount;
                    $parsed++;
                }
            }
            $result->finalize();
            $amount = $parsed > 0 ? MetricTools::normalizedNumber($sum) : null;
            return [$amount, $parsed === $expectedQuotes ? 'ok' : 'partial'];
        } catch (Throwable) {
            return [null, 'unavailable'];
        }
    }

    /** @return array<string,int> */
    private function topBuckets(SQLite3 $database, ReportWindow $window, string $dimension): array
    {
        $expression = $dimension === 'form'
            ? "CASE WHEN form_id = 'cart:quote' THEN 'quote' WHEN form_id LIKE '%:request-%' OR form_id = 'page:request' THEN 'regular' ELSE 'other' END"
            : "CASE WHEN page_path = '/' THEN 'home' WHEN page_path = '/cart/' OR page_path LIKE '/cart/%' THEN 'cart' WHEN page_path = '/catalog/' OR page_path LIKE '/catalog/%' THEN 'catalog' WHEN page_path = '/maf/' OR page_path LIKE '/maf/%' THEN 'maf' WHEN page_path = '/metallokonstrukcii/' OR page_path LIKE '/metallokonstrukcii/%' THEN 'metal' WHEN page_path = '/ograzhdeniya/' OR page_path LIKE '/ograzhdeniya/%' THEN 'fences' WHEN page_path = '/contacts/' OR page_path LIKE '/contacts/%' THEN 'contacts' WHEN page_path = '/projects/' OR page_path LIKE '/projects/%' THEN 'projects' ELSE 'other' END";
        $statement = $database->prepare("SELECT {$expression} AS bucket, COUNT(*) AS total FROM leads WHERE received_at >= :start_utc AND received_at < :end_utc GROUP BY bucket ORDER BY total DESC, bucket ASC LIMIT 3");
        if ($statement === false) {
            throw new AnalyticsFailure('sqlite_prepare_failed', 'Unable to prepare source summary');
        }
        $statement->bindValue(':start_utc', $window->startIso(), SQLITE3_TEXT);
        $statement->bindValue(':end_utc', $window->endIso(), SQLITE3_TEXT);
        $result = $statement->execute();
        if (!$result instanceof SQLite3Result) {
            throw new AnalyticsFailure('sqlite_query_failed', 'Unable to execute source summary');
        }
        $counts = [];
        while (($row = $result->fetchArray(SQLITE3_ASSOC)) !== false) {
            if (is_string($row['bucket'] ?? null)) {
                $counts[$row['bucket']] = max(0, (int)($row['total'] ?? 0));
            }
        }
        $result->finalize();
        return $counts;
    }

    /** @return array{outbox_sent:int,outbox_failed:int,outbox_pending:int,outbox_status:string} */
    private function outboxSummary(SQLite3 $database, ReportWindow $window): array
    {
        $statement = $database->prepare(<<<'SQL'
SELECT
  COALESCE(SUM(CASE WHEN status = 'sent' AND sent_at >= :start_utc AND sent_at < :end_utc THEN 1 ELSE 0 END), 0) AS sent,
  COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
  COALESCE(SUM(CASE WHEN status IN ('pending', 'sending') THEN 1 ELSE 0 END), 0) AS pending
FROM outbox
SQL);
        if ($statement === false) {
            throw new AnalyticsFailure('sqlite_prepare_failed', 'Unable to prepare outbox summary');
        }
        $statement->bindValue(':start_utc', $window->startIso(), SQLITE3_TEXT);
        $statement->bindValue(':end_utc', $window->endIso(), SQLITE3_TEXT);
        $result = $statement->execute();
        $row = $result instanceof SQLite3Result ? $result->fetchArray(SQLITE3_ASSOC) : false;
        if ($result instanceof SQLite3Result) {
            $result->finalize();
        }
        if (!is_array($row)) {
            throw new AnalyticsFailure('sqlite_query_failed', 'Unable to execute outbox summary');
        }
        $failed = max(0, (int)($row['failed'] ?? 0));
        $pending = max(0, (int)($row['pending'] ?? 0));
        return [
            'outbox_sent' => max(0, (int)($row['sent'] ?? 0)),
            'outbox_failed' => $failed,
            'outbox_pending' => $pending,
            'outbox_status' => $failed > 0 || $pending > 0 ? 'attention' : 'ok',
        ];
    }
}

final class MetricTools
{
    public static function rubles(mixed $value): int|float|null
    {
        if ((is_int($value) || is_float($value)) && is_finite((float)$value)) {
            $number = (float)$value;
        } elseif (is_string($value)) {
            $clean = preg_replace('/[\s\x{00A0}\x{202F}₽]/u', '', trim($value));
            if (!is_string($clean) || preg_match('/^\d+(?:[.,]\d{1,2})?$/D', $clean) !== 1) {
                return null;
            }
            $number = (float)str_replace(',', '.', $clean);
        } else {
            return null;
        }
        if (!is_finite($number) || $number < 0 || $number > 1000000000000) {
            return null;
        }
        return self::normalizedNumber($number);
    }

    public static function normalizedNumber(float $value): int|float
    {
        $rounded = round($value, 2);
        return floor($rounded) === $rounded ? (int)$rounded : $rounded;
    }

    public static function formBucket(string $formId): string
    {
        if ($formId === 'cart:quote') {
            return 'quote';
        }
        if ($formId === 'page:request' || preg_match('/^[\p{L}\p{N}_\.\/:\-]+:request-\d+$/uD', $formId) === 1) {
            return 'regular';
        }
        return 'other';
    }

    public static function pageBucket(string $path): string
    {
        $routes = [
            'cart' => '/cart',
            'catalog' => '/catalog',
            'maf' => '/maf',
            'metal' => '/metallokonstrukcii',
            'fences' => '/ograzhdeniya',
            'contacts' => '/contacts',
            'projects' => '/projects',
        ];
        if ($path === '/') {
            return 'home';
        }
        foreach ($routes as $bucket => $prefix) {
            if ($path === $prefix . '/' || str_starts_with($path, $prefix . '/')) {
                return $bucket;
            }
        }
        return 'other';
    }
}

final class JsonLeadSummarySource implements LeadSummarySource
{
    public function __construct(private readonly string $path)
    {
    }

    public function label(): string
    {
        return 'json';
    }

    public function summarize(ReportWindow $window): array
    {
        if ($this->path === '-') {
            $body = stream_get_contents(STDIN);
        } else {
            $real = realpath($this->path);
            if (!is_string($real) || !is_file($real) || is_link($this->path) || !is_readable($real)) {
                throw new AnalyticsFailure('json_unavailable', 'Lead JSON input is unavailable');
            }
            $size = filesize($real);
            if ($size === false || $size > 5 * 1024 * 1024) {
                throw new AnalyticsFailure('json_too_large', 'Lead JSON input exceeds 5 MiB');
            }
            $body = file_get_contents($real);
        }
        if (!is_string($body)) {
            throw new AnalyticsFailure('json_read_failed', 'Unable to read lead JSON input');
        }
        try {
            $decoded = json_decode($body, true, 16, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new AnalyticsFailure('json_invalid', 'Lead JSON input is invalid');
        }
        $rows = is_array($decoded) && array_is_list($decoded) ? $decoded : ($decoded['leads'] ?? null);
        if (!is_array($rows) || !array_is_list($rows) || count($rows) > 100000) {
            throw new AnalyticsFailure('json_schema_invalid', 'Lead JSON input must contain a leads array of at most 100000 rows');
        }

        $summary = emptyLeadSummary();
        $formCounts = [];
        $pageCounts = [];
        $parsedQuoteAmounts = 0;
        $quoteSum = 0.0;
        $previousStart = new DateTimeImmutable($window->previousStartIso());
        foreach ($rows as $row) {
            if (!is_array($row) || !is_string($row['received_at'] ?? null) || !is_string($row['form_id'] ?? null)) {
                throw new AnalyticsFailure('json_schema_invalid', 'Each lead JSON row requires received_at and form_id strings');
            }
            try {
                $received = new DateTimeImmutable($row['received_at']);
            } catch (Throwable) {
                throw new AnalyticsFailure('json_timestamp_invalid', 'Lead JSON input contains an invalid received_at timestamp');
            }
            if ($received >= $previousStart && $received < $window->startUtc) {
                $summary['previous_total']++;
                continue;
            }
            if ($received >= $window->startUtc && $received < $window->endUtc) {
                $summary['total']++;
                if ($row['form_id'] === 'cart:quote') {
                    $summary['kp']++;
                    $amount = MetricTools::rubles($row['quote_total_rub'] ?? null);
                    if ($amount !== null) {
                        $quoteSum += $amount;
                        $parsedQuoteAmounts++;
                    }
                } else {
                    $summary['regular']++;
                }
                $formBucket = MetricTools::formBucket($row['form_id']);
                $pageBucket = MetricTools::pageBucket(is_string($row['page_path'] ?? null) ? $row['page_path'] : '');
                $formCounts[$formBucket] = ($formCounts[$formBucket] ?? 0) + 1;
                $pageCounts[$pageBucket] = ($pageCounts[$pageBucket] ?? 0) + 1;
            }
        }
        arsort($formCounts);
        arsort($pageCounts);
        $summary['top_form_counts'] = array_slice($formCounts, 0, 3, true);
        $summary['top_page_counts'] = array_slice($pageCounts, 0, 3, true);
        if ($summary['kp'] === 0) {
            $summary['kp_amount_rub'] = 0;
            $summary['kp_amount_status'] = 'no_data';
        } else {
            $summary['kp_amount_rub'] = $parsedQuoteAmounts > 0 ? MetricTools::normalizedNumber($quoteSum) : null;
            $summary['kp_amount_status'] = $parsedQuoteAmounts === $summary['kp'] ? 'ok' : 'partial';
        }
        return $summary;
    }
}

final class CountPrivacy
{
    public function __construct(private readonly int $minimumReportableCount)
    {
    }

    public function external(int $count): string
    {
        if ($this->canReport($count)) {
            return (string)$count;
        }
        return '<' . $this->minimumReportableCount;
    }

    public function canReport(int $count): bool
    {
        return $count === 0 || $this->minimumReportableCount === 1 || $count >= $this->minimumReportableCount;
    }

    public function policy(): string
    {
        return $this->minimumReportableCount === 1
            ? 'exact'
            : 'suppress_1_to_' . ($this->minimumReportableCount - 1);
    }
}

final class CurlJsonClient
{
    private const MAX_RESPONSE_BYTES = 1048576;

    public function __construct(
        private readonly string $baseUrl,
        private readonly string $oauthToken,
        private readonly int $timeoutSeconds
    ) {
        Settings::assertSafeApiBase($baseUrl);
        if (!extension_loaded('curl')) {
            throw new AnalyticsFailure('curl_extension_missing', 'PHP curl extension is unavailable');
        }
    }

    /** @param array<string,string|int|list<string|int>> $query
     *  @return array<string,mixed>
     */
    public function get(string $path, array $query = []): array
    {
        if ($path === '' || $path[0] !== '/' || str_contains($path, '..') || preg_match('/[\x00-\x20\x7f]/', $path) === 1) {
            throw new AnalyticsFailure('yandex_path_invalid', 'Yandex Webmaster API path is invalid');
        }
        $url = rtrim($this->baseUrl, '/') . $path;
        if ($query !== []) {
            $url .= '?' . self::buildQuery($query);
        }
        $handle = curl_init($url);
        if ($handle === false) {
            throw new AnalyticsFailure('yandex_http_init', 'Unable to initialize the Yandex Webmaster request');
        }
        $body = '';
        $tooLarge = false;
        curl_setopt_array($handle, [
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => min(5, $this->timeoutSeconds),
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'Authorization: OAuth ' . $this->oauthToken,
            ],
            CURLOPT_USERAGENT => 'EGOE-Daily-Analytics/1.0',
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_PROXY => '',
            CURLOPT_NOPROXY => '*',
            CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$body, &$tooLarge): int {
                if (strlen($body) + strlen($chunk) > self::MAX_RESPONSE_BYTES) {
                    $tooLarge = true;
                    return 0;
                }
                $body .= $chunk;
                return strlen($chunk);
            },
        ]);
        $scheme = strtolower((string)(parse_url($this->baseUrl, PHP_URL_SCHEME) ?? ''));
        if (defined('CURLOPT_PROTOCOLS')) {
            curl_setopt($handle, CURLOPT_PROTOCOLS, $scheme === 'https' ? CURLPROTO_HTTPS : CURLPROTO_HTTP);
        }
        $ok = curl_exec($handle);
        $status = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $curlError = curl_errno($handle);
        curl_close($handle);

        if ($tooLarge) {
            throw new AnalyticsFailure('yandex_response_too_large', 'Yandex Webmaster response exceeded 1 MiB');
        }
        if ($ok === false || $curlError !== 0) {
            throw new AnalyticsFailure('yandex_transport_error', 'Yandex Webmaster request failed');
        }
        if ($status < 200 || $status >= 300) {
            throw new AnalyticsFailure('yandex_http_' . $status, 'Yandex Webmaster returned an unsuccessful status');
        }
        try {
            $decoded = json_decode($body, true, 64, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new AnalyticsFailure('yandex_json_invalid', 'Yandex Webmaster returned invalid JSON');
        }
        if (!is_array($decoded)) {
            throw new AnalyticsFailure('yandex_json_invalid', 'Yandex Webmaster returned an invalid JSON object');
        }
        return $decoded;
    }

    /** @param array<string,string|int|list<string|int>> $query */
    private static function buildQuery(array $query): string
    {
        $pairs = [];
        foreach ($query as $name => $value) {
            if (!is_string($name) || $name === '') {
                throw new AnalyticsFailure('yandex_query_invalid', 'Yandex Webmaster query is invalid');
            }
            $values = is_array($value) ? $value : [$value];
            if ($values === []) {
                throw new AnalyticsFailure('yandex_query_invalid', 'Yandex Webmaster query is invalid');
            }
            foreach ($values as $item) {
                if (!is_string($item) && !is_int($item)) {
                    throw new AnalyticsFailure('yandex_query_invalid', 'Yandex Webmaster query is invalid');
                }
                $pairs[] = rawurlencode($name) . '=' . rawurlencode((string)$item);
            }
        }
        return implode('&', $pairs);
    }
}

final class YandexWebmaster
{
    /** @param array<string,mixed> $settings */
    public function __construct(
        private readonly array $settings,
        private readonly CurlJsonClient $client
    ) {
    }

    /** @return array<string,string|int|float|bool|null> */
    public function collect(ReportWindow $window): array
    {
        $user = $this->client->get('/user');
        $userId = $user['user_id'] ?? null;
        if ((!is_int($userId) && !is_string($userId)) || preg_match('/^\d+$/D', (string)$userId) !== 1) {
            throw new AnalyticsFailure('yandex_user_invalid', 'Yandex Webmaster user response has no valid user_id');
        }
        $userId = (string)$userId;
        $hosts = $this->client->get('/user/' . rawurlencode($userId) . '/hosts');
        $host = $this->selectHost($hosts['hosts'] ?? null);
        $hostId = (string)$host['host_id'];
        $hostPath = '/user/' . rawurlencode($userId) . '/hosts/' . rawurlencode($hostId);

        $result = self::emptyResult();
        $result['yandex_host_url'] = $this->safeHostUrl($host);
        $successfulParts = 0;

        try {
            $summary = $this->client->get($hostPath . '/summary');
            $result = array_replace($result, $this->summaryFields($summary));
            $result['yandex_summary_status'] = 'ok';
            $successfulParts++;
        } catch (AnalyticsFailure $error) {
            $result['yandex_summary_status'] = 'error';
            $result['yandex_summary_error'] = $error->errorCode;
        }

        try {
            $history = $this->client->get($hostPath . '/search-queries/all/history', [
                'query_indicator' => ['TOTAL_SHOWS', 'TOTAL_CLICKS', 'AVG_SHOW_POSITION'],
                'device_type_indicator' => 'ALL',
                'date_from' => $window->date,
                'date_to' => $window->date,
            ]);
            $result = array_replace($result, $this->searchFields($history, $window));
            $result['yandex_search_status'] = $result['yandex_data_date'] === null ? 'no_data' : 'ok';
            $successfulParts++;
        } catch (AnalyticsFailure $error) {
            $result['yandex_search_status'] = 'error';
            $result['yandex_search_error'] = $error->errorCode;
        }

        $result['yandex_status'] = $successfulParts === 2 ? 'ok' : ($successfulParts === 1 ? 'partial' : 'error');
        return $result;
    }

    /** @return array<string,string|int|float|bool|null> */
    public static function emptyResult(string $status = 'disabled'): array
    {
        return [
            'yandex_status' => $status,
            'yandex_host_url' => null,
            'yandex_summary_status' => $status,
            'yandex_summary_error' => null,
            'yandex_sqi' => null,
            'yandex_searchable_pages' => null,
            'yandex_excluded_pages' => null,
            'yandex_problems_fatal' => null,
            'yandex_problems_critical' => null,
            'yandex_problems_possible' => null,
            'yandex_recommendations' => null,
            'yandex_search_status' => $status,
            'yandex_search_error' => null,
            'yandex_data_date' => null,
            'yandex_impressions' => null,
            'yandex_clicks' => null,
            'yandex_ctr_percent' => null,
            'yandex_avg_show_position' => null,
        ];
    }

    /** @param mixed $hosts
     *  @return array<string,mixed>
     */
    private function selectHost(mixed $hosts): array
    {
        if (!is_array($hosts) || !array_is_list($hosts)) {
            throw new AnalyticsFailure('yandex_hosts_invalid', 'Yandex Webmaster hosts response is invalid');
        }
        $desired = [];
        foreach ($this->settings['site_urls'] as $index => $url) {
            $normalized = Settings::normalizeSiteUrl((string)$url);
            if (is_string($normalized)) {
                $desired[$normalized] = 1000 - (int)$index;
            }
        }
        $explicit = trim((string)$this->settings['host_id']);
        $matches = [];
        foreach ($hosts as $host) {
            if (!is_array($host) || ($host['verified'] ?? false) !== true || !is_string($host['host_id'] ?? null)) {
                continue;
            }
            if ($explicit !== '' && hash_equals($explicit, $host['host_id'])) {
                return $host;
            }
            foreach (['ascii_host_url', 'unicode_host_url'] as $field) {
                if (!is_string($host[$field] ?? null)) {
                    continue;
                }
                $normalized = Settings::normalizeSiteUrl($host[$field]);
                if (is_string($normalized) && isset($desired[$normalized])) {
                    $matches[] = ['score' => $desired[$normalized], 'host' => $host];
                    break;
                }
            }
        }
        if ($explicit !== '') {
            throw new AnalyticsFailure('yandex_host_not_found', 'Configured Yandex Webmaster host_id is unavailable or unverified');
        }
        if ($matches === []) {
            throw new AnalyticsFailure('yandex_host_not_found', 'No verified Yandex Webmaster host matches site_urls');
        }
        usort($matches, static fn(array $left, array $right): int => $right['score'] <=> $left['score']);
        return $matches[0]['host'];
    }

    /** @param array<string,mixed> $host */
    private function safeHostUrl(array $host): ?string
    {
        foreach (['ascii_host_url', 'unicode_host_url'] as $field) {
            if (is_string($host[$field] ?? null) && Settings::normalizeSiteUrl($host[$field]) !== null) {
                return $host[$field];
            }
        }
        return null;
    }

    /** @param array<string,mixed> $summary
     *  @return array<string,string|int|float|bool|null>
     */
    private function summaryFields(array $summary): array
    {
        $problems = is_array($summary['site_problems'] ?? null) ? $summary['site_problems'] : [];
        return [
            'yandex_sqi' => self::nullableInteger($summary['sqi'] ?? null),
            'yandex_searchable_pages' => self::nullableInteger($summary['searchable_pages_count'] ?? null),
            'yandex_excluded_pages' => self::nullableInteger($summary['excluded_pages_count'] ?? null),
            'yandex_problems_fatal' => self::nullableInteger($problems['FATAL'] ?? 0),
            'yandex_problems_critical' => self::nullableInteger($problems['CRITICAL'] ?? 0),
            'yandex_problems_possible' => self::nullableInteger($problems['POSSIBLE_PROBLEM'] ?? 0),
            'yandex_recommendations' => self::nullableInteger($problems['RECOMMENDATION'] ?? 0),
        ];
    }

    /** @param array<string,mixed> $history
     *  @return array<string,string|int|float|bool|null>
     */
    private function searchFields(array $history, ReportWindow $window): array
    {
        $indicators = is_array($history['indicators'] ?? null) ? $history['indicators'] : [];
        $shows = $this->indicator($indicators['TOTAL_SHOWS'] ?? null, $window);
        $clicks = $this->indicator($indicators['TOTAL_CLICKS'] ?? null, $window);
        $position = $this->indicator($indicators['AVG_SHOW_POSITION'] ?? null, $window);
        $date = $shows['date'] ?? $clicks['date'] ?? $position['date'] ?? null;
        $impressions = self::nullableInteger($shows['value'] ?? null);
        $clickCount = self::nullableInteger($clicks['value'] ?? null);
        $ctr = null;
        if ($impressions !== null && $clickCount !== null) {
            $ctr = $impressions > 0 ? round(($clickCount / $impressions) * 100, 2) : 0.0;
        }
        return [
            'yandex_data_date' => $date,
            'yandex_impressions' => $impressions,
            'yandex_clicks' => $clickCount,
            'yandex_ctr_percent' => $ctr,
            'yandex_avg_show_position' => self::nullableFloat($position['value'] ?? null),
        ];
    }

    /** @param mixed $series
     *  @return array{date:string,value:mixed}|null
     */
    private function indicator(mixed $series, ReportWindow $window): ?array
    {
        if (!is_array($series) || !array_is_list($series)) {
            return null;
        }
        foreach ($series as $point) {
            if (!is_array($point) || !is_string($point['date'] ?? null) || !array_key_exists('value', $point)) {
                continue;
            }
            try {
                $date = new DateTimeImmutable(str_replace(',', '.', $point['date']));
            } catch (Throwable) {
                continue;
            }
            $localDate = $date->setTimezone($window->timezone)->format('Y-m-d');
            if ($localDate === $window->date) {
                return ['date' => $localDate, 'value' => $point['value']];
            }
        }
        return null;
    }

    private static function nullableInteger(mixed $value): ?int
    {
        if (is_int($value)) {
            return $value >= 0 ? $value : null;
        }
        if (is_float($value) && is_finite($value) && $value >= 0 && floor($value) === $value) {
            return (int)$value;
        }
        if (is_string($value) && preg_match('/^\d+$/D', $value) === 1) {
            return (int)$value;
        }
        return null;
    }

    private static function nullableFloat(mixed $value): ?float
    {
        if ((is_int($value) || is_float($value)) && is_finite((float)$value) && (float)$value >= 0) {
            return round((float)$value, 2);
        }
        if (is_string($value) && is_numeric($value) && is_finite((float)$value) && (float)$value >= 0) {
            return round((float)$value, 2);
        }
        return null;
    }
}

final class DailySender
{
    private const MAX_RESPONSE_BYTES = 65536;

    /** @param array<string,mixed> $delivery
     *  @param array<string,string|int|float|bool|null> $report
     */
    public function send(array $delivery, array $report): string
    {
        if (($delivery['enabled'] ?? false) !== true) {
            throw new AnalyticsFailure('delivery_disabled', 'Daily delivery is disabled');
        }
        $url = (string)$delivery['url'];
        Settings::assertSafeDeliveryUrl($url);
        $approvedHash = (string)$delivery['url_sha256'];
        if (preg_match('/^[a-f0-9]{64}$/D', $approvedHash) !== 1
            || !hash_equals($approvedHash, hash('sha256', $url))
        ) {
            throw new AnalyticsFailure('delivery_url_hash_invalid', 'Daily delivery URL does not match its approved SHA-256');
        }
        if (!extension_loaded('curl')) {
            throw new AnalyticsFailure('curl_extension_missing', 'PHP curl extension is unavailable');
        }
        $reportId = is_string($report['report_id'] ?? null) ? $report['report_id'] : '';
        $reportDate = is_string($report['report_date'] ?? null) ? $report['report_date'] : '';
        if (preg_match('/^egoe-\d{4}-\d{2}-\d{2}$/D', $reportId) !== 1
            || preg_match('/^\d{4}-\d{2}-\d{2}$/D', $reportDate) !== 1
            || $reportId !== 'egoe-' . $reportDate
            || !is_string($report['_subject'] ?? null)
            || !is_string($report['Сообщение'] ?? null)
        ) {
            throw new AnalyticsFailure('delivery_report_invalid', 'Daily delivery report is invalid');
        }
        $body = json_encode([
            '_subject' => $report['_subject'],
            'Сообщение' => $report['Сообщение'],
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $payloadHash = hash('sha256', $body);
        $directory = $this->safeReceiptsDirectory((string)$delivery['receipts_dir']);
        $receipt = $directory . '/sent-' . $reportDate . '.json';
        if ($this->receiptStatus($receipt, $reportId, $payloadHash) === 'sent') {
            return 'already_sent';
        }

        $lock = $directory . '/.lock-' . $reportDate;
        if (!@mkdir($lock, 0700)) {
            throw new AnalyticsFailure('delivery_locked', 'Daily delivery is already running or requires lock review');
        }
        try {
            if ($this->receiptStatus($receipt, $reportId, $payloadHash) === 'sent') {
                return 'already_sent';
            }
            $this->post($url, $body, $reportId, (int)$delivery['timeout_seconds']);
            $this->writeReceipt($directory, $receipt, $reportId, $payloadHash);
            return 'sent';
        } finally {
            if (is_dir($lock) && !is_link($lock)) {
                rmdir($lock);
            }
        }
    }

    private function safeReceiptsDirectory(string $path): string
    {
        $real = realpath($path);
        if (!is_string($real) || !is_dir($real) || is_link($path) || !is_readable($real) || !is_writable($real)) {
            throw new AnalyticsFailure('delivery_receipts_invalid', 'Daily delivery receipts directory is unavailable');
        }
        $permissions = fileperms($real);
        if ($permissions === false || ($permissions & 0777) !== 0700) {
            throw new AnalyticsFailure('delivery_receipts_permissions', 'Daily delivery receipts directory permissions must be 0700');
        }
        if (function_exists('posix_geteuid')) {
            $owner = fileowner($real);
            if ($owner === false || $owner !== posix_geteuid()) {
                throw new AnalyticsFailure('delivery_receipts_owner', 'Daily delivery receipts directory must belong to the runtime user');
            }
        }
        return $real;
    }

    private function receiptStatus(string $path, string $reportId, string $payloadHash): string
    {
        $metadata = @lstat($path);
        if ($metadata === false) {
            return 'absent';
        }
        $regularFile = (((int)($metadata['mode'] ?? 0)) & 0170000) === 0100000;
        $permissions = ((int)($metadata['mode'] ?? 0)) & 0777;
        $ownerMatches = !function_exists('posix_geteuid') || ($metadata['uid'] ?? null) === posix_geteuid();
        if (!$regularFile || $permissions !== 0600 || !$ownerMatches || (int)($metadata['size'] ?? 0) > 4096) {
            throw new AnalyticsFailure('delivery_receipt_invalid', 'Daily delivery receipt is unsafe');
        }
        $body = file_get_contents($path);
        if (!is_string($body)) {
            throw new AnalyticsFailure('delivery_receipt_invalid', 'Daily delivery receipt is unreadable');
        }
        try {
            $decoded = json_decode($body, true, 8, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new AnalyticsFailure('delivery_receipt_invalid', 'Daily delivery receipt is invalid');
        }
        if (!is_array($decoded)
            || ($decoded['schema'] ?? null) !== 'egoe.daily-delivery-receipt.v1'
            || ($decoded['report_id'] ?? null) !== $reportId
            || ($decoded['payload_sha256'] ?? null) !== $payloadHash
        ) {
            throw new AnalyticsFailure('delivery_receipt_mismatch', 'Daily delivery receipt does not match this report');
        }
        return 'sent';
    }

    private function post(string $url, string $body, string $reportId, int $timeout): void
    {
        $handle = curl_init($url);
        if ($handle === false) {
            throw new AnalyticsFailure('delivery_http_init', 'Unable to initialize daily delivery');
        }
        $response = '';
        $tooLarge = false;
        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'Content-Type: application/json',
                'Idempotency-Key: ' . $reportId,
            ],
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => min(5, $timeout),
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_USERAGENT => 'EGOE-Daily-Analytics/1.0',
            CURLOPT_PROXY => '',
            CURLOPT_NOPROXY => '*',
            CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$response, &$tooLarge): int {
                if (strlen($response) + strlen($chunk) > self::MAX_RESPONSE_BYTES) {
                    $tooLarge = true;
                    return 0;
                }
                $response .= $chunk;
                return strlen($chunk);
            },
        ]);
        $scheme = strtolower((string)(parse_url($url, PHP_URL_SCHEME) ?? ''));
        if (defined('CURLOPT_PROTOCOLS')) {
            curl_setopt($handle, CURLOPT_PROTOCOLS, $scheme === 'https' ? CURLPROTO_HTTPS : CURLPROTO_HTTP);
        }
        $ok = curl_exec($handle);
        $status = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $curlError = curl_errno($handle);
        curl_close($handle);
        if ($tooLarge || $ok === false || $curlError !== 0 || $status < 200 || $status >= 300) {
            throw new AnalyticsFailure('delivery_failed', 'Daily delivery failed');
        }
        try {
            $decoded = json_decode($response, true, 8, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new AnalyticsFailure('delivery_response_invalid', 'Daily delivery response is invalid');
        }
        if (!is_array($decoded) || ($decoded['ok'] ?? null) !== true) {
            throw new AnalyticsFailure('delivery_response_rejected', 'Daily delivery response did not confirm success');
        }
    }

    private function writeReceipt(string $directory, string $receipt, string $reportId, string $payloadHash): void
    {
        if (@lstat($receipt) !== false) {
            throw new AnalyticsFailure('delivery_receipt_exists', 'Daily delivery receipt appeared unexpectedly');
        }
        $temporary = tempnam($directory, '.receipt-');
        if (!is_string($temporary)) {
            throw new AnalyticsFailure('delivery_receipt_write', 'Unable to create daily delivery receipt');
        }
        try {
            $body = json_encode([
                'schema' => 'egoe.daily-delivery-receipt.v1',
                'report_id' => $reportId,
                'payload_sha256' => $payloadHash,
                'sent_at' => (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z'),
            ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
            if (file_put_contents($temporary, $body, LOCK_EX) !== strlen($body)
                || !chmod($temporary, 0600)
                || !rename($temporary, $receipt)
            ) {
                throw new AnalyticsFailure('delivery_receipt_write', 'Unable to persist daily delivery receipt');
            }
        } finally {
            if (is_file($temporary)) {
                unlink($temporary);
            }
        }
    }
}

final class DailyReport
{
    /** @param array<string,mixed> $settings */
    public function __construct(private readonly array $settings)
    {
    }

    /** @return array<string,string|int|float|bool|null> */
    public function build(ReportWindow $window, LeadSummarySource $source, bool $skipYandex = false): array
    {
        $summary = $source->summarize($window);
        $privacy = new CountPrivacy((int)$this->settings['privacy']['minimum_reportable_count']);
        $current = max(0, (int)($summary['total'] ?? 0));
        $quotes = max(0, min($current, (int)($summary['kp'] ?? 0)));
        $regular = max(0, min($current, (int)($summary['regular'] ?? 0)));
        $previous = max(0, (int)($summary['previous_total'] ?? 0));
        $comparisonVisible = $privacy->canReport($current) && $privacy->canReport($previous);
        $pipelineStatus = is_string($summary['kp_amount_status'] ?? null)
            ? $summary['kp_amount_status']
            : 'unavailable';
        if (!$privacy->canReport($quotes)) {
            $pipelineStatus = 'suppressed';
        }
        $report = [
            'schema' => 'egoe.daily-analytics.v1',
            'report_id' => 'egoe-' . $window->date,
            'report_date' => $window->date,
            'report_timezone' => $window->timezone->getName(),
            'generated_at' => (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z'),
            'lead_source' => $source->label(),
            'count_policy' => $privacy->policy(),
            'accepted_leads_proxy' => $privacy->external($current),
            'leads_total' => $privacy->external($current),
            'kp_requests' => $privacy->external($quotes),
            'regular_requests' => $privacy->external($regular),
            'previous_day_leads' => $privacy->external($previous),
            'leads_delta_vs_previous' => $comparisonVisible ? $current - $previous : null,
            'leads_change_percent' => $comparisonVisible && $previous > 0
                ? round((($current - $previous) / $previous) * 100, 1)
                : null,
            'kp_pipeline_rub' => $pipelineStatus !== 'suppressed' ? ($summary['kp_amount_rub'] ?? null) : null,
            'kp_pipeline_status' => $pipelineStatus,
            'top_form_sources' => $this->formatTop($summary['top_form_counts'] ?? [], 'form', $privacy),
            'top_page_sources' => $this->formatTop($summary['top_page_counts'] ?? [], 'page', $privacy),
            'outbox_status' => is_string($summary['outbox_status'] ?? null) ? $summary['outbox_status'] : 'unavailable',
            'outbox_sent' => max(0, (int)($summary['outbox_sent'] ?? 0)),
            'outbox_failed' => max(0, (int)($summary['outbox_failed'] ?? 0)),
            'outbox_pending' => max(0, (int)($summary['outbox_pending'] ?? 0)),
        ];

        $webmaster = $this->settings['yandex_webmaster'];
        if ($skipYandex || ($webmaster['enabled'] ?? false) !== true) {
            $yandex = YandexWebmaster::emptyResult('disabled');
        } else {
            try {
                $token = Settings::resolveWebmasterToken($this->settings);
                if ($token === '') {
                    throw new AnalyticsFailure('yandex_token_missing', 'Yandex Webmaster OAuth token is missing');
                }
                $client = new CurlJsonClient(
                    (string)$webmaster['api_base_url'],
                    $token,
                    (int)$webmaster['timeout_seconds']
                );
                $yandex = (new YandexWebmaster($webmaster, $client))->collect($window);
            } catch (AnalyticsFailure $error) {
                $yandex = YandexWebmaster::emptyResult('error');
                $yandex['yandex_summary_error'] = $error->errorCode;
                $yandex['yandex_search_error'] = $error->errorCode;
            }
        }
        $report = array_replace($report, $yandex);
        $report['_subject'] = 'EGOE — ежедневная аналитика за ' . self::displayDate($window->date);
        $report['Сообщение'] = $this->message($report);
        self::assertFlat($report);
        return $report;
    }

    /** @param array<string,string|int|float|bool|null> $report */
    private function message(array $report): string
    {
        $lines = [
            'EGOE — итоги за ' . self::displayDate((string)$report['report_date']) . ' (МСК)',
            'Принятые заявки (proxy, не продажи): ' . $report['accepted_leads_proxy'],
            'Предыдущий день: ' . $report['previous_day_leads'] . self::comparison($report),
            'КП: ' . $report['kp_requests'] . '; pipeline: ' . self::pipeline($report),
            'Остальные формы (не КП): ' . $report['regular_requests'],
        ];
        if (is_string($report['top_page_sources']) && $report['top_page_sources'] !== '') {
            $lines[] = 'Топ разделов: ' . $report['top_page_sources'];
        }
        if (is_string($report['top_form_sources']) && $report['top_form_sources'] !== '') {
            $lines[] = 'Типы форм: ' . $report['top_form_sources'];
        }
        if ($report['yandex_status'] === 'ok' || $report['yandex_status'] === 'partial') {
            $search = 'Яндекс Поиск: ';
            if ($report['yandex_search_status'] === 'ok') {
                $search .= self::metric($report['yandex_impressions']) . ' показов, '
                    . self::metric($report['yandex_clicks']) . ' кликов, CTR '
                    . self::metric($report['yandex_ctr_percent'], '%') . ', ср. позиция '
                    . self::metric($report['yandex_avg_show_position']);
            } elseif ($report['yandex_search_status'] === 'no_data') {
                $search .= 'данные за дату ещё не появились';
            } else {
                $search .= 'статистика временно недоступна';
            }
            $lines[] = $search;
            if ($report['yandex_summary_status'] === 'ok') {
                $lines[] = 'Индексирование: ' . self::metric($report['yandex_searchable_pages'])
                    . ' страниц в поиске, ИКС ' . self::metric($report['yandex_sqi']);
                $lines[] = 'Проблемы: фатальные ' . self::metric($report['yandex_problems_fatal'])
                    . ', критические ' . self::metric($report['yandex_problems_critical']);
            } else {
                $lines[] = 'Индексирование: сводка временно недоступна';
            }
            if (is_string($report['yandex_data_date']) && $report['yandex_data_date'] !== '') {
                $lines[] = 'Дата данных Яндекса: ' . self::displayDate($report['yandex_data_date']);
            }
        } elseif ($report['yandex_status'] === 'disabled') {
            $lines[] = 'Яндекс Вебмастер: не подключён';
        } else {
            $lines[] = 'Яндекс Вебмастер: временно недоступен';
        }
        if ($report['outbox_status'] === 'unavailable') {
            $lines[] = 'Очередь уведомлений: нет данных для этого источника';
        } else {
            $lines[] = 'Очередь: отправлено за день ' . self::metric($report['outbox_sent'])
                . ', failed ' . self::metric($report['outbox_failed'])
                . ', pending ' . self::metric($report['outbox_pending']);
        }
        return implode("\n", $lines);
    }

    /** @param mixed $counts */
    private function formatTop(mixed $counts, string $dimension, CountPrivacy $privacy): ?string
    {
        if (!is_array($counts) || $counts === []) {
            return null;
        }
        $labels = $dimension === 'form'
            ? ['quote' => 'КП', 'regular' => 'обычные', 'other' => 'другие']
            : [
                'home' => 'главная',
                'cart' => 'корзина/КП',
                'catalog' => 'каталог',
                'maf' => 'МАФ',
                'metal' => 'металлоконструкции',
                'fences' => 'ограждения',
                'contacts' => 'контакты',
                'projects' => 'проекты',
                'other' => 'другие',
            ];
        $parts = [];
        foreach ($counts as $bucket => $count) {
            if (!is_string($bucket) || !isset($labels[$bucket]) || !is_int($count) || $count < 0) {
                continue;
            }
            $parts[] = $labels[$bucket] . ': ' . $privacy->external($count);
        }
        return $parts === [] ? null : implode('; ', array_slice($parts, 0, 3));
    }

    /** @param array<string,string|int|float|bool|null> $report */
    private static function comparison(array $report): string
    {
        if (!is_int($report['leads_delta_vs_previous'])) {
            return '';
        }
        $delta = $report['leads_delta_vs_previous'];
        $text = '; ' . ($delta > 0 ? '+' : '') . $delta;
        if (is_float($report['leads_change_percent']) || is_int($report['leads_change_percent'])) {
            $percent = (float)$report['leads_change_percent'];
            $text .= ' (' . ($percent > 0 ? '+' : '') . self::metric($percent, '%') . ')';
        }
        return $text;
    }

    /** @param array<string,string|int|float|bool|null> $report */
    private static function pipeline(array $report): string
    {
        return match ($report['kp_pipeline_status']) {
            'ok' => self::metric($report['kp_pipeline_rub'], ' ₽'),
            'partial' => self::metric($report['kp_pipeline_rub'], ' ₽') . ' (частично)',
            'no_data' => '0 ₽',
            'suppressed' => 'скрыто политикой малых чисел',
            default => 'нет данных',
        };
    }

    private static function metric(mixed $value, string $suffix = ''): string
    {
        if ($value === null) {
            return '—';
        }
        if (is_float($value)) {
            return rtrim(rtrim(number_format($value, 2, ',', ' '), '0'), ',') . $suffix;
        }
        if (is_int($value)) {
            return number_format($value, 0, ',', ' ') . $suffix;
        }
        return (string)$value . $suffix;
    }

    private static function displayDate(string $date): string
    {
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date, new DateTimeZone('UTC'));
        return $parsed instanceof DateTimeImmutable ? $parsed->format('d.m.Y') : $date;
    }

    /** @param array<string,mixed> $payload */
    public static function assertFlat(array $payload): void
    {
        foreach ($payload as $key => $value) {
            if (!is_string($key) || is_array($value) || is_object($value) || is_resource($value)) {
                throw new AnalyticsFailure('report_not_flat', 'Daily report must be a flat JSON object');
            }
        }
    }
}
