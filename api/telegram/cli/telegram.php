<?php

declare(strict_types=1);

umask(0077);

use Egoe\Leads\Database;
use Egoe\Leads\Runtime;
use Egoe\Leads\Settings;
use Egoe\Telegram\CurlBotApi;
use Egoe\Telegram\TelegramConfig;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__, 2) . '/leads/lib/LeadBackend.php';
require dirname(__DIR__) . '/lib/TelegramHistory.php';

function failTelegram(string $message, int $code = 1): never
{
    fwrite(STDERR, "ERROR: {$message}\n");
    exit($code);
}

try {
    $command = $argv[1] ?? 'help';
    $root = Runtime::deployRoot();
    $leadSettings = Settings::load($root);
    $settings = TelegramConfig::load($root);
    if (($settings['enabled'] ?? false) !== true) {
        failTelegram('Telegram history is disabled');
    }
    Database::connect($root);
    $api = new CurlBotApi((string)$settings['bot_token'], (int)$settings['timeout_seconds']);
    switch ($command) {
        case 'health':
            echo json_encode([
                'ok' => true,
                'historyEnabled' => true,
                'deliveryEnabled' => ($settings['send_leads'] ?? false) === true,
                'allowedChatCount' => count($settings['allowed_chat_ids']),
                'allowedUserCount' => count($settings['allowed_user_ids']),
                'identityKeyAvailable' => is_string($leadSettings['ip_hash_key']) && strlen($leadSettings['ip_hash_key']) >= 32,
            ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
            break;
        case 'webhook-info':
            $info = $api->call('getWebhookInfo', []);
            echo json_encode($info, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
            break;
        case 'register-webhook':
            $replace = in_array('--replace', $argv, true);
            $info = $api->call('getWebhookInfo', []);
            $currentUrl = is_array($info) && is_string($info['url'] ?? null) ? $info['url'] : '';
            if ($currentUrl !== '' && $currentUrl !== TelegramConfig::WEBHOOK_URL && !$replace) {
                failTelegram('A different Telegram webhook already exists; inspect it and use --replace explicitly');
            }
            $api->call('setWebhook', [
                'url' => TelegramConfig::WEBHOOK_URL,
                'secret_token' => $settings['webhook_secret'],
                'allowed_updates' => ['callback_query'],
                'max_connections' => 4,
                'drop_pending_updates' => false,
            ]);
            echo "REGISTERED " . TelegramConfig::WEBHOOK_URL . "\n";
            break;
        default:
            echo "Usage: php api/telegram/cli/telegram.php health|webhook-info|register-webhook [--replace]\n";
            exit($command === 'help' ? 0 : 1);
    }
} catch (Throwable $error) {
    failTelegram($error->getMessage());
}
