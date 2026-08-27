<?php

declare(strict_types=1);

umask(0077);

use Egoe\Leads\Database;
use Egoe\Leads\Runtime;
use Egoe\Leads\Settings;
use Egoe\Leads\Validator;
use Egoe\Telegram\CallbackHandler;
use Egoe\Telegram\CurlBotApi;
use Egoe\Telegram\TelegramConfig;

require dirname(__DIR__) . '/leads/lib/LeadBackend.php';
require __DIR__ . '/lib/TelegramHistory.php';

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, private, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Frame-Options: DENY');
header('Content-Security-Policy: default-src \'none\'; frame-ancestors \'none\'; base-uri \'none\'');

try {
    $requestPath = parse_url((string)($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
    if (!is_string($requestPath)
        || !in_array($requestPath, ['/api/telegram/webhook', '/api/telegram/webhook/'], true)
    ) {
        http_response_code(404);
        echo '{"ok":false}';
        exit;
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        header('Allow: POST');
        http_response_code(405);
        echo '{"ok":false}';
        exit;
    }
    $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length < 1 || $length > 131072) {
        http_response_code(413);
        echo '{"ok":false}';
        exit;
    }
    if (!str_starts_with(strtolower((string)($_SERVER['CONTENT_TYPE'] ?? '')), 'application/json')) {
        http_response_code(415);
        echo '{"ok":false}';
        exit;
    }

    $root = Runtime::deployRoot();
    $leadSettings = Settings::load($root);
    Validator::assertRequestHost($leadSettings, $_SERVER);
    $settings = TelegramConfig::load($root);
    if (($settings['enabled'] ?? false) !== true) {
        http_response_code(404);
        echo '{"ok":false}';
        exit;
    }
    $providedSecret = $_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] ?? null;
    if (!is_string($providedSecret)
        || !hash_equals((string)$settings['webhook_secret'], $providedSecret)
    ) {
        http_response_code(404);
        echo '{"ok":false}';
        exit;
    }
    $raw = file_get_contents('php://input');
    if (!is_string($raw) || strlen($raw) !== $length) {
        throw new RuntimeException('Telegram webhook body is unavailable');
    }
    $update = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($update) || array_is_list($update)) {
        throw new RuntimeException('Telegram update is invalid');
    }
    $settings['identity_key'] = $leadSettings['ip_hash_key'];
    $pdo = Database::connect($root);
    $api = new CurlBotApi((string)$settings['bot_token'], (int)$settings['timeout_seconds']);
    CallbackHandler::handle($update, $settings, $pdo, $api);
    http_response_code(200);
    echo '{"ok":true}';
} catch (Throwable) {
    http_response_code(500);
    echo '{"ok":false}';
}
