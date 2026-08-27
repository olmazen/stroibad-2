<?php

declare(strict_types=1);

use Egoe\Leads\Database;
use Egoe\Leads\LeadStore;
use Egoe\Leads\Outbox;
use Egoe\Leads\Runtime;
use Egoe\Leads\Settings;
use Egoe\Leads\Validator;
use Egoe\Telegram\CurlBotApi;
use Egoe\Telegram\TelegramConfig;
use Egoe\Telegram\TelegramLeadTransport;

require dirname(__DIR__) . '/api/leads/lib/LeadBackend.php';
require dirname(__DIR__) . '/api/telegram/lib/TelegramHistory.php';

$root = Runtime::deployRoot();
$settings = Settings::load($root);
$telegram = TelegramConfig::load($root);
$apiBase = getenv('EGOE_TELEGRAM_TEST_API_BASE');
$caFile = getenv('EGOE_TELEGRAM_TEST_CA');
if (!is_string($apiBase) || $apiBase === '' || !is_string($caFile) || $caFile === '') {
    throw new RuntimeException('Telegram delivery test transport is unavailable');
}
$transport = Outbox::selectTransport(
    $settings,
    new TelegramLeadTransport(
        $telegram,
        new CurlBotApi(
            (string)$telegram['bot_token'],
            (int)$telegram['timeout_seconds'],
            $apiBase,
            $caFile
        )
    )
);
$pdo = Database::connect($root);
$command = (string)($argv[1] ?? '');

if ($command === 'seed') {
    $leadId = strtolower((string)($argv[2] ?? ''));
    $existing = $pdo->prepare('SELECT payload_json FROM leads WHERE lead_id = :lead_id');
    $existing->execute([':lead_id' => $leadId]);
    $existingPayload = $existing->fetchColumn();
    $now = Runtime::utcNow();
    $lead = is_string($existingPayload) ? json_decode($existingPayload, true, 32, JSON_THROW_ON_ERROR) : Validator::payload([
        'schemaVersion' => 1,
        'leadId' => $leadId,
        'formId' => 'cart:quote',
        'tag' => 'КП',
        'createdAt' => $now,
        'consent' => [
            'accepted' => true,
            'version' => Settings::CURRENT_CONSENT_VERSION,
            'acceptedAt' => $now,
            'documentUrl' => 'https://www.egoe-life.ru/consent/',
        ],
        'page' => [
            'url' => 'https://www.egoe-life.ru/system-test/?must=not-leak',
            'title' => 'Системный тест',
            'referrer' => '',
        ],
        'spamCheck' => ['website' => '', 'elapsedMs' => 1000],
        'fields' => [
            'Имя' => 'Екатерина',
            'Телефон' => '+7 927 229-58-28',
            'E-mail' => 'direct.test@example.invalid',
            'Компания' => '',
            'Позиции' => '• Скамейка стальная «Дуга» (RAL 7016) — 3 шт × 22 270 = 66 810 ₽',
            'Итого' => '66 810 ₽',
            '№ КП' => 'КП-2026-0827-123456',
        ],
        'journey' => [
            ['path' => '/catalog/', 'title' => 'Каталог', 'viewedAt' => $now],
            ['path' => '/system-test/', 'title' => 'Тест', 'viewedAt' => $now],
        ],
    ], $settings);
    $accepted = LeadStore::accept(
        $pdo,
        $lead,
        $settings,
        hash_hmac('sha256', '127.0.0.1', (string)$settings['ip_hash_key']),
        $transport
    );
    echo json_encode($accepted, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
    exit;
}

if ($command === 'retry') {
    echo json_encode(Outbox::retry($pdo, $transport, 20), JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
    exit;
}

if ($command === 'due') {
    $pdo->exec("UPDATE outbox SET next_attempt_at = '2000-01-01T00:00:00.000Z' WHERE mode = 'telegram' AND status = 'failed'");
    echo "DUE\n";
    exit;
}

if ($command === 'status') {
    echo json_encode(
        $pdo->query("SELECT lead_id, mode, status, attempts FROM outbox ORDER BY id")->fetchAll(),
        JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    ) . "\n";
    exit;
}

throw new RuntimeException('Usage: telegram-delivery-harness.php seed <UUID>|retry|due|status');
