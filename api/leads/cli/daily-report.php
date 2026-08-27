#!/usr/bin/env php
<?php

declare(strict_types=1);

use Egoe\Analytics\AnalyticsFailure;
use Egoe\Analytics\DailyReport;
use Egoe\Analytics\DailySender;
use Egoe\Analytics\JsonLeadSummarySource;
use Egoe\Analytics\ReportWindow;
use Egoe\Analytics\Settings;
use Egoe\Analytics\SqliteLeadSummarySource;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../lib/DailyAnalytics.php';

/** @return array{config:string,date:?string,inputJson:?string,pretty:bool,skipYandex:bool,send:bool,help:bool} */
function parseArguments(array $arguments): array
{
    $options = [
        'config' => '',
        'date' => null,
        'inputJson' => null,
        'pretty' => false,
        'skipYandex' => false,
        'send' => false,
        'help' => false,
    ];
    for ($index = 0; $index < count($arguments); $index++) {
        $argument = (string)$arguments[$index];
        switch ($argument) {
            case '--config':
                $options['config'] = (string)($arguments[++$index] ?? '');
                break;
            case '--date':
                $options['date'] = (string)($arguments[++$index] ?? '');
                break;
            case '--input-json':
                $options['inputJson'] = (string)($arguments[++$index] ?? '');
                break;
            case '--pretty':
                $options['pretty'] = true;
                break;
            case '--no-yandex':
                $options['skipYandex'] = true;
                break;
            case '--send':
                $options['send'] = true;
                break;
            case '--help':
            case '-h':
                $options['help'] = true;
                break;
            default:
                throw new AnalyticsFailure('argument_unknown', 'Unknown argument: ' . $argument);
        }
    }
    return $options;
}

function usage(): string
{
    return <<<'TEXT'
Usage:
  php api/leads/cli/daily-report.php --config /absolute/private/config.php [options]

Options:
  --date YYYY-MM-DD   Report a specific local calendar day (default: yesterday).
  --input-json PATH   Read fixture rows from JSON instead of SQLite; use - for stdin.
  --no-yandex         Skip optional Yandex Webmaster API calls.
  --send              Deliver only _subject and Сообщение, once per report date.
  --pretty            Pretty-print the otherwise one-line flat JSON object.
  --help              Show this help.

The config path can also be provided with EGOE_ANALYTICS_CONFIG.
TEXT;
}

try {
    $options = parseArguments(array_slice($argv, 1));
    if ($options['help']) {
        fwrite(STDOUT, usage() . "\n");
        exit(0);
    }
    $environmentConfig = getenv('EGOE_ANALYTICS_CONFIG');
    $configPath = $options['config'] !== ''
        ? $options['config']
        : (is_string($environmentConfig) ? $environmentConfig : '');
    if ($configPath === '') {
        throw new AnalyticsFailure('config_required', 'Use --config or EGOE_ANALYTICS_CONFIG');
    }
    $settings = Settings::load($configPath);
    $window = ReportWindow::forDate($options['date'], (string)$settings['timezone']);

    if (is_string($options['inputJson'])) {
        if ($options['inputJson'] === '') {
            throw new AnalyticsFailure('json_path_required', '--input-json requires a path or -');
        }
        $source = new JsonLeadSummarySource($options['inputJson']);
    } elseif (($settings['leads']['source'] ?? null) === 'json') {
        $jsonPath = (string)($settings['leads']['json_path'] ?? '');
        if ($jsonPath === '') {
            throw new AnalyticsFailure('json_path_required', 'Configured JSON input path is empty');
        }
        $source = new JsonLeadSummarySource($jsonPath);
    } else {
        $sqlitePath = (string)($settings['leads']['sqlite_path'] ?? '');
        if ($sqlitePath === '') {
            throw new AnalyticsFailure('sqlite_path_required', 'Configured SQLite path is empty');
        }
        $source = new SqliteLeadSummarySource($sqlitePath);
    }

    $report = (new DailyReport($settings))->build($window, $source, $options['skipYandex']);
    if ($options['send']) {
        $report['delivery_status'] = (new DailySender())->send($settings['delivery'], $report);
        DailyReport::assertFlat($report);
    }
    $flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR;
    if ($options['pretty']) {
        $flags |= JSON_PRETTY_PRINT;
    }
    fwrite(STDOUT, json_encode($report, $flags) . "\n");
} catch (AnalyticsFailure $error) {
    fwrite(STDERR, 'ERROR [' . $error->errorCode . ']: ' . $error->getMessage() . "\n");
    exit(1);
} catch (Throwable) {
    fwrite(STDERR, "ERROR [unexpected]: Daily analytics report failed\n");
    exit(1);
}
