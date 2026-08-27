<?php

declare(strict_types=1);

use Egoe\Leads\Database;
use Egoe\Leads\Runtime;
use Egoe\Leads\Settings;
use Egoe\Telegram\BotApi;
use Egoe\Telegram\BotApiFailure;
use Egoe\Telegram\CallbackHandler;
use Egoe\Telegram\TelegramConfig;
use Egoe\Telegram\TelegramText;

require dirname(__DIR__) . '/api/leads/lib/LeadBackend.php';
require dirname(__DIR__) . '/api/telegram/lib/TelegramHistory.php';

class RecordingBotApi implements BotApi
{
    /** @var list<array{method:string,parameters:array<string,mixed>}> */
    public array $calls = [];

    public function call(string $method, array $parameters): mixed
    {
        $this->calls[] = ['method' => $method, 'parameters' => $parameters];
        return true;
    }
}

final class AlreadyModifiedBotApi extends RecordingBotApi
{
    public function call(string $method, array $parameters): mixed
    {
        $this->calls[] = ['method' => $method, 'parameters' => $parameters];
        if ($method === 'editMessageText') {
            throw new BotApiFailure(400, 'Bad Request: message is not modified');
        }
        return true;
    }
}

final class AlreadySettledBotApi extends RecordingBotApi
{
    public function call(string $method, array $parameters): mixed
    {
        $this->calls[] = ['method' => $method, 'parameters' => $parameters];
        if ($method === 'editMessageText') {
            throw new BotApiFailure(400, 'Bad Request: message is not modified');
        }
        if ($method === 'answerCallbackQuery') {
            throw new BotApiFailure(400, 'Bad Request: query is too old and response timeout expired');
        }
        return true;
    }
}

/** @param array<string,string> $fields
 *  @param list<array{path:string,title:string,viewedAt:string}> $journey
 */
function insertHarnessLead(PDO $pdo, string $leadId, string $time, array $fields, array $journey): void
{
    $payload = [
        'schemaVersion' => 1,
        'leadId' => $leadId,
        'formId' => 'test:quote',
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
        'journey' => $journey,
        'fields' => $fields,
    ];
    $json = static fn (mixed $value): string => json_encode(
        $value,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    );
    $statement = $pdo->prepare(<<<'SQL'
INSERT INTO leads (
  lead_id, payload_hash, form_id, tag, created_at, received_at, page_path, page_title,
  page_referrer, consent_version, consent_accepted_at, consent_document_url,
  fields_json, payload_json, ip_hash
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
SQL);
    $statement->execute([
        $leadId,
        hash('sha256', $json($payload)),
        'test:quote',
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

/** @return array<string,mixed> */
function callbackUpdate(string $data, string $userId = '777000111'): array
{
    return [
        'update_id' => 100,
        'callback_query' => [
            'id' => 'callback-query-id',
            'from' => ['id' => (int)$userId, 'is_bot' => false],
            'message' => [
                'message_id' => 55,
                'from' => ['id' => 123456789, 'is_bot' => true],
                'chat' => ['id' => -1001234567890, 'type' => 'supergroup'],
                'reply_markup' => ['inline_keyboard' => [[[
                    'text' => 'Кнопка',
                    'callback_data' => $data,
                ]]]],
            ],
            'data' => $data,
        ],
    ];
}

$root = Runtime::deployRoot();
$leadSettings = Settings::load($root);
$telegramSettings = TelegramConfig::load($root);
if (($telegramSettings['enabled'] ?? false) !== true) {
    throw new RuntimeException('Telegram history test config is disabled');
}
$telegramSettings['identity_key'] = $leadSettings['ip_hash_key'];
$pdo = Database::connect($root);
$first = '11111111-1111-4111-8111-111111111111';
$second = '22222222-2222-4222-8222-222222222222';
insertHarnessLead($pdo, $first, '2026-08-26T08:00:00.000Z', [
    'Имя' => 'Анна',
    'Телефон' => '8 (927) 123-45-67',
    'E-mail' => 'Customer@example.com',
    'Итого' => '10 000 ₽',
    '№ КП' => 'КП-1',
], [
    ['path' => '/catalog/', 'title' => 'Каталог', 'viewedAt' => '2026-08-26T07:58:00.000Z'],
    ['path' => '/cart/', 'title' => 'Корзина', 'viewedAt' => '2026-08-26T08:00:00.000Z'],
]);
insertHarnessLead($pdo, $second, '2026-08-27T08:30:00.000Z', [
    'Имя' => 'Анна',
    'Телефон' => '+7 927 123-45-67',
    'E-mail' => 'customer@example.com',
    'Компания' => '',
    'Итого' => '25 000 ₽',
    '№ КП' => 'КП-2',
], [
    ['path' => '/maf/skamejki/', 'title' => 'Скамейки', 'viewedAt' => '2026-08-27T08:25:00.000Z'],
    ['path' => '/cart/', 'title' => 'Корзина', 'viewedAt' => '2026-08-27T08:30:00.000Z'],
]);

$historyApi = new RecordingBotApi();
CallbackHandler::handle(
    callbackUpdate(TelegramText::historyCallback($second)),
    $telegramSettings,
    $pdo,
    $historyApi
);
$leadApi = new RecordingBotApi();
CallbackHandler::handle(
    callbackUpdate(TelegramText::leadCallback($second)),
    $telegramSettings,
    $pdo,
    $leadApi
);
$unauthorizedApi = new RecordingBotApi();
CallbackHandler::handle(
    callbackUpdate(TelegramText::historyCallback($second), '777000999'),
    $telegramSettings,
    $pdo,
    $unauthorizedApi
);
$forged = callbackUpdate(TelegramText::historyCallback($second));
$forged['callback_query']['message']['reply_markup']['inline_keyboard'][0][0]['callback_data'] = TelegramText::historyCallback($first);
$forgedApi = new RecordingBotApi();
CallbackHandler::handle($forged, $telegramSettings, $pdo, $forgedApi);
$alreadyModifiedApi = new AlreadyModifiedBotApi();
CallbackHandler::handle(
    callbackUpdate(TelegramText::historyCallback($second)),
    $telegramSettings,
    $pdo,
    $alreadyModifiedApi
);
$alreadySettledApi = new AlreadySettledBotApi();
CallbackHandler::handle(
    callbackUpdate(TelegramText::historyCallback($second)),
    $telegramSettings,
    $pdo,
    $alreadySettledApi
);

echo json_encode([
    'history' => $historyApi->calls,
    'lead' => $leadApi->calls,
    'unauthorized' => $unauthorizedApi->calls,
    'forged' => $forgedApi->calls,
    'alreadyModified' => $alreadyModifiedApi->calls,
    'alreadySettled' => $alreadySettledApi->calls,
    'historyCallbackBytes' => strlen(TelegramText::historyCallback($second)),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
