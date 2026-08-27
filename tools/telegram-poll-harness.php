<?php

declare(strict_types=1);

use Egoe\Leads\Database;
use Egoe\Leads\Runtime;
use Egoe\Leads\Settings;
use Egoe\Telegram\CurlBotApi;
use Egoe\Telegram\TelegramConfig;
use Egoe\Telegram\TelegramLongPollWorker;
use Egoe\Telegram\TelegramPollState;

require dirname(__DIR__) . '/api/leads/lib/LeadBackend.php';
require dirname(__DIR__) . '/api/telegram/lib/TelegramHistory.php';

final class TransientFailurePdo extends PDO
{
    public function __construct()
    {
    }

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        throw new PDOException('Synthetic transient database failure');
    }
}

function pollHarnessFail(string $message): never
{
    fwrite(STDERR, "ERROR: {$message}\n");
    exit(1);
}

/** @param array<string,string> $fields */
function pollHarnessSeed(PDO $pdo, string $leadId, array $fields): void
{
    $time = '2026-08-27T08:30:00.000Z';
    $payload = [
        'schemaVersion' => 1,
        'leadId' => $leadId,
        'formId' => 'test:polling',
        'tag' => 'КП',
        'createdAt' => $time,
        'consent' => [
            'accepted' => true,
            'version' => '2026-08-27',
            'acceptedAt' => $time,
            'documentUrl' => 'https://www.egoe-life.ru/consent/',
        ],
        'page' => [
            'url' => 'https://www.egoe-life.ru/cart/',
            'path' => '/cart/',
            'title' => 'Корзина',
            'referrer' => '',
        ],
        'journey' => [
            ['path' => '/catalog/', 'title' => 'Каталог', 'viewedAt' => '2026-08-27T08:25:00.000Z'],
            ['path' => '/cart/', 'title' => 'Корзина', 'viewedAt' => $time],
        ],
        'fields' => $fields,
    ];
    $json = static fn (mixed $value): string => json_encode(
        $value,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    );
    $statement = $pdo->prepare(<<<'SQL'
INSERT OR IGNORE INTO leads (
  lead_id, payload_hash, form_id, tag, created_at, received_at, page_path, page_title,
  page_referrer, consent_version, consent_accepted_at, consent_document_url,
  fields_json, payload_json, ip_hash
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
SQL);
    $statement->execute([
        $leadId,
        hash('sha256', $json($payload)),
        'test:polling',
        'КП',
        $time,
        $time,
        '/cart/',
        'Корзина',
        '',
        '2026-08-27',
        $time,
        'https://www.egoe-life.ru/consent/',
        $json($fields),
        $json($payload),
        hash('sha256', 'test-ip'),
    ]);
}

try {
    $root = Runtime::deployRoot();
    $leadSettings = Settings::load($root);
    $settings = TelegramConfig::load($root);
    if (($settings['enabled'] ?? false) !== true) {
        throw new RuntimeException('Telegram history is disabled');
    }
    $settings['identity_key'] = $leadSettings['ip_hash_key'];
    $pdo = Database::connect($root);
    $apiBase = getenv('EGOE_TELEGRAM_TEST_API_BASE');
    $caFile = getenv('EGOE_TELEGRAM_TEST_CA');
    if (!is_string($apiBase) || $apiBase === '' || !is_string($caFile) || $caFile === '') {
        throw new RuntimeException('Telegram polling test transport is unavailable');
    }
    $api = new CurlBotApi(
        (string)$settings['bot_token'],
        (int)$settings['timeout_seconds'],
        $apiBase,
        $caFile
    );

    $command = $argv[1] ?? 'help';
    if ($command === 'seed') {
        $leadId = $argv[2] ?? '';
        if (!is_string($leadId)
            || preg_match('/\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}\z/D', $leadId) !== 1
        ) {
            throw new RuntimeException('Seed lead ID is invalid');
        }
        pollHarnessSeed($pdo, $leadId, [
            'Имя' => 'Тест polling',
            'Телефон' => '+7 927 229-58-28',
            'E-mail' => 'polling.test@example.invalid',
            'Компания' => '',
            'Позиции' => 'Тестовая позиция — 1 шт',
            'Итого' => '10 000 ₽',
            '№ КП' => 'TEST-POLL-1',
        ]);
        echo "SEEDED\n";
        exit(0);
    }

    $state = TelegramPollState::acquire($root);
    if ($state === null) {
        echo json_encode(['ok' => true, 'busy' => true], JSON_THROW_ON_ERROR) . "\n";
        exit(0);
    }
    try {
        if ($command === 'poll' || $command === 'poll-db-failure') {
            $limit = isset($argv[2]) ? (int)$argv[2] : 10;
            $workerPdo = $command === 'poll-db-failure' ? new TransientFailurePdo() : $pdo;
            echo json_encode([
                'ok' => true,
                'busy' => false,
                ...(new TelegramLongPollWorker($settings, $workerPdo, $api, $state))->poll($limit),
            ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
        } elseif ($command === 'offset') {
            echo json_encode(['ok' => true, 'offset' => $state->offset()], JSON_THROW_ON_ERROR) . "\n";
        } elseif ($command === 'hold') {
            $milliseconds = isset($argv[2]) ? (int)$argv[2] : 500;
            if ($milliseconds < 1 || $milliseconds > 5000) {
                throw new RuntimeException('Lock hold time is invalid');
            }
            echo "LOCKED\n";
            fflush(STDOUT);
            usleep($milliseconds * 1000);
            echo "RELEASED\n";
        } elseif ($command === 'delete-webhook') {
            TelegramLongPollWorker::disableWebhook($api);
            echo "WEBHOOK_DELETED_PENDING_PRESERVED\n";
        } else {
            throw new RuntimeException('Usage: telegram-poll-harness.php seed|poll|poll-db-failure|offset|hold|delete-webhook');
        }
    } finally {
        $state->close();
    }
} catch (Throwable $error) {
    pollHarnessFail($error->getMessage());
}
