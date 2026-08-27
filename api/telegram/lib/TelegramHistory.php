<?php

declare(strict_types=1);

namespace Egoe\Telegram;

use DateTimeImmutable;
use DateTimeZone;
use Egoe\Leads\CustomerHistory;
use Egoe\Leads\OutboxTransport;
use Egoe\Leads\Runtime;
use JsonException;
use PDO;
use RuntimeException;
use Throwable;

interface BotApi
{
    /** @param array<string,mixed> $parameters
     *  @return mixed
     */
    public function call(string $method, array $parameters): mixed;
}

final class BotApiFailure extends RuntimeException
{
    public function __construct(
        public readonly int $errorCode,
        public readonly string $apiDescription
    ) {
        parent::__construct('Telegram Bot API request failed');
    }

    public function isMessageNotModified(): bool
    {
        return $this->errorCode === 400
            && str_contains(mb_strtolower($this->apiDescription, 'UTF-8'), 'message is not modified');
    }
}

final class TelegramConfig
{
    public const WEBHOOK_URL = 'https://www.egoe-life.ru/api/telegram/webhook/';

    /** @return array<string,mixed> */
    public static function loadOptional(string $deployRoot): array
    {
        $directory = $deployRoot . '/shared/telegram';
        $config = $directory . '/config.php';
        if (!file_exists($directory) && !is_link($directory)) {
            return self::defaults();
        }
        if (!file_exists($config) && !is_link($config)) {
            throw new RuntimeException('Telegram configuration is incomplete');
        }
        return self::load($deployRoot);
    }

    /** @return array<string,mixed> */
    public static function load(string $deployRoot): array
    {
        $sharedRoot = realpath($deployRoot . '/shared');
        $directoryPath = $deployRoot . '/shared/telegram';
        $directory = realpath($directoryPath);
        if (!is_string($sharedRoot)
            || !is_string($directory)
            || !is_dir($directory)
            || is_link($directoryPath)
            || !str_starts_with($directory . '/', $sharedRoot . '/')
        ) {
            throw new RuntimeException('Telegram configuration is unavailable');
        }
        self::assertOwnedMode($deployRoot, $directory, 0700, true);

        $configPath = $directory . '/config.php';
        if (!is_file($configPath) || is_link($configPath) || !is_readable($configPath)) {
            throw new RuntimeException('Telegram configuration is unavailable');
        }
        self::assertOwnedMode($deployRoot, $configPath, 0600, false);
        $loaded = (static fn (string $file): mixed => require $file)($configPath);
        if (!is_array($loaded)) {
            throw new RuntimeException('Telegram configuration must return an array');
        }
        $settings = array_replace(self::defaults(), $loaded);
        if (!is_bool($settings['enabled']) || !is_bool($settings['send_leads'])) {
            throw new RuntimeException('Telegram enabled flags must be boolean');
        }
        $settings['enabled'] = $settings['enabled'] === true
            && Runtime::telegramHistoryApproved($deployRoot);
        $settings['send_leads'] = $settings['send_leads'] === true
            && Runtime::telegramDeliveryApproved($deployRoot)
            && $settings['enabled'];
        if (!$settings['enabled'] && !$settings['send_leads']) {
            return $settings;
        }

        $token = $settings['bot_token'] ?? null;
        if (!is_string($token)
            || preg_match('/\A([1-9][0-9]{5,15}):[A-Za-z0-9_-]{30,100}\z/D', $token, $match) !== 1
            || str_contains($token, 'REPLACE_')
        ) {
            throw new RuntimeException('Telegram bot token is invalid');
        }
        $settings['bot_id'] = $match[1];
        $secret = $settings['webhook_secret'] ?? null;
        if (!is_string($secret)
            || preg_match('/\A[A-Za-z0-9_-]{32,256}\z/D', $secret) !== 1
            || str_contains($secret, 'REPLACE_')
        ) {
            throw new RuntimeException('Telegram webhook secret is invalid');
        }
        $settings['allowed_chat_ids'] = self::ids($settings['allowed_chat_ids'] ?? null, true);
        $settings['allowed_user_ids'] = self::ids($settings['allowed_user_ids'] ?? null, false);
        if ($settings['allowed_chat_ids'] === [] || $settings['allowed_user_ids'] === []) {
            throw new RuntimeException('Telegram chat and user allowlists must be non-empty');
        }
        if ($settings['send_leads']) {
            $deliveryChatId = $settings['delivery_chat_id'] ?? null;
            if (!is_string($deliveryChatId)
                || preg_match('/\A-[1-9][0-9]{0,19}\z/D', $deliveryChatId) !== 1
                || !in_array($deliveryChatId, $settings['allowed_chat_ids'], true)
            ) {
                throw new RuntimeException('Telegram delivery_chat_id must be an allowed group');
            }
        }
        if (!is_int($settings['timeout_seconds'])
            || $settings['timeout_seconds'] < 1
            || $settings['timeout_seconds'] > 10
        ) {
            throw new RuntimeException('Telegram timeout_seconds must be between 1 and 10');
        }
        if (!is_int($settings['max_history_entries'])
            || $settings['max_history_entries'] < 1
            || $settings['max_history_entries'] > 20
        ) {
            throw new RuntimeException('Telegram max_history_entries must be between 1 and 20');
        }
        return $settings;
    }

    /** @return array<string,mixed> */
    private static function defaults(): array
    {
        return [
            'enabled' => false,
            'send_leads' => false,
            'bot_token' => '',
            'webhook_secret' => '',
            'delivery_chat_id' => '',
            'allowed_chat_ids' => [],
            'allowed_user_ids' => [],
            'timeout_seconds' => 5,
            'max_history_entries' => 10,
        ];
    }

    /** @return list<string> */
    private static function ids(mixed $value, bool $chat): array
    {
        if (!is_array($value) || !array_is_list($value)) {
            throw new RuntimeException('Telegram allowlist must be a list');
        }
        $result = [];
        $seen = [];
        foreach ($value as $id) {
            if (!is_string($id)) {
                throw new RuntimeException('Telegram allowlist IDs must be strings');
            }
            $pattern = $chat ? '/\A-[1-9][0-9]{0,19}\z/D' : '/\A[1-9][0-9]{0,19}\z/D';
            if (preg_match($pattern, $id) !== 1) {
                throw new RuntimeException('Telegram allowlist contains an invalid ID');
            }
            if (!isset($seen['id:' . $id])) {
                $seen['id:' . $id] = true;
                $result[] = $id;
            }
        }
        return $result;
    }

    private static function assertOwnedMode(string $deployRoot, string $path, int $mode, bool $directory): void
    {
        $rootMetadata = @lstat($deployRoot);
        $metadata = @lstat($path);
        $expectedType = $directory ? 0040000 : 0100000;
        if (!is_array($rootMetadata)
            || !is_array($metadata)
            || (($metadata['mode'] ?? 0) & 0170000) !== $expectedType
            || (($metadata['mode'] ?? 0) & 0777) !== $mode
            || ($metadata['uid'] ?? null) !== ($rootMetadata['uid'] ?? null)
        ) {
            throw new RuntimeException('Telegram configuration permissions are unsafe');
        }
    }
}

final class CurlBotApi implements BotApi
{
    private readonly string $apiBase;
    private readonly string $caFile;

    public function __construct(
        private readonly string $token,
        private readonly int $timeoutSeconds,
        string $apiBase = 'https://api.telegram.org',
        string $caFile = ''
    ) {
        $parts = parse_url($apiBase);
        if (!is_array($parts)
            || strtolower((string)($parts['scheme'] ?? '')) !== 'https'
            || !is_string($parts['host'] ?? null)
            || ($parts['host'] ?? '') === ''
            || isset($parts['user'])
            || isset($parts['pass'])
            || isset($parts['query'])
            || isset($parts['fragment'])
            || !in_array((string)($parts['path'] ?? ''), ['', '/'], true)
        ) {
            throw new RuntimeException('Telegram Bot API base is invalid');
        }
        $this->apiBase = rtrim($apiBase, '/');
        if ($caFile !== '') {
            $realCa = realpath($caFile);
            if (!is_string($realCa) || !is_file($realCa) || is_link($caFile) || !is_readable($realCa)) {
                throw new RuntimeException('Telegram Bot API CA file is unavailable');
            }
            $caFile = $realCa;
        }
        $this->caFile = $caFile;
    }

    public function call(string $method, array $parameters): mixed
    {
        if (!extension_loaded('curl') || preg_match('/\A[A-Za-z][A-Za-z0-9]{1,63}\z/D', $method) !== 1) {
            throw new RuntimeException('Telegram Bot API client is unavailable');
        }
        $handle = curl_init($this->apiBase . '/bot' . $this->token . '/' . $method);
        if ($handle === false) {
            throw new RuntimeException('Unable to initialize Telegram Bot API request');
        }
        $body = json_encode(
            $parameters,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
        );
        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => false,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => min(3, $this->timeoutSeconds),
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_USERAGENT => 'EGOE-Telegram-History/1.0',
        ]);
        if ($this->caFile !== '') {
            curl_setopt($handle, CURLOPT_CAINFO, $this->caFile);
        }
        $response = curl_exec($handle);
        $status = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $error = curl_errno($handle);
        curl_close($handle);
        if ($response === false || $error !== 0) {
            throw new RuntimeException('Telegram Bot API request failed');
        }
        try {
            $decoded = json_decode((string)$response, true, 64, JSON_THROW_ON_ERROR);
        } catch (JsonException $error) {
            throw new RuntimeException('Telegram Bot API response is invalid', 0, $error);
        }
        if (is_array($decoded)
            && ($decoded['ok'] ?? null) === false
            && is_int($decoded['error_code'] ?? null)
            && is_string($decoded['description'] ?? null)
        ) {
            throw new BotApiFailure($decoded['error_code'], $decoded['description']);
        }
        if ($status < 200 || $status >= 300 || !is_array($decoded) || ($decoded['ok'] ?? null) !== true) {
            throw new RuntimeException('Telegram Bot API request failed');
        }
        return $decoded['result'] ?? true;
    }
}

final class TelegramLeadTransport implements OutboxTransport
{
    /** @param array<string,mixed> $settings */
    public function __construct(
        private readonly array $settings,
        private readonly ?BotApi $api
    ) {
        if ($this->enabled() && $this->api === null) {
            throw new RuntimeException('Telegram lead transport requires a Bot API client');
        }
    }

    /** @param array<string,mixed> $settings */
    public static function production(array $settings): self
    {
        $api = ($settings['send_leads'] ?? false) === true
            ? new CurlBotApi((string)$settings['bot_token'], (int)$settings['timeout_seconds'])
            : null;
        return new self($settings, $api);
    }

    public function enabled(): bool
    {
        return ($this->settings['send_leads'] ?? false) === true;
    }

    public function mode(): string
    {
        return 'telegram';
    }

    public function payload(array $lead): array
    {
        $leadId = (string)($lead['leadId'] ?? '');
        TelegramText::historyCallback($leadId);
        return [
            'schemaVersion' => 1,
            'kind' => 'telegram-lead',
            'leadId' => strtolower($leadId),
        ];
    }

    public function deliver(PDO $pdo, string $leadId, string $payloadJson): void
    {
        if (!$this->enabled() || $this->api === null) {
            throw new RuntimeException('Telegram lead transport is disabled');
        }
        try {
            $payload = json_decode($payloadJson, true, 8, JSON_THROW_ON_ERROR);
        } catch (JsonException $error) {
            throw new RuntimeException('Telegram outbox payload is invalid', 0, $error);
        }
        if (!is_array($payload)
            || array_is_list($payload)
            || array_keys($payload) !== ['schemaVersion', 'kind', 'leadId']
            || ($payload['schemaVersion'] ?? null) !== 1
            || ($payload['kind'] ?? null) !== 'telegram-lead'
            || !is_string($payload['leadId'] ?? null)
            || !hash_equals(strtolower($leadId), strtolower($payload['leadId']))
        ) {
            throw new RuntimeException('Telegram outbox payload is invalid');
        }
        $lead = TelegramText::lead($pdo, $leadId);
        $result = $this->api->call('sendMessage', [
            'chat_id' => (string)$this->settings['delivery_chat_id'],
            'text' => $lead['text'],
            'link_preview_options' => ['is_disabled' => true],
            'reply_markup' => $lead['reply_markup'],
        ]);
        $resultChat = is_array($result) && is_array($result['chat'] ?? null)
            ? ($result['chat']['id'] ?? null)
            : null;
        $resultChat = is_int($resultChat) ? (string)$resultChat : $resultChat;
        if (!is_array($result)
            || !is_int($result['message_id'] ?? null)
            || $result['message_id'] < 1
            || !is_string($resultChat)
            || !hash_equals((string)$this->settings['delivery_chat_id'], $resultChat)
        ) {
            throw new RuntimeException('Telegram sendMessage confirmation is invalid');
        }
    }
}

final class TelegramText
{
    public const HISTORY_PREFIX = 'ch1:';
    public const LEAD_PREFIX = 'cl1:';
    private const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

    public static function historyCallback(string $leadId): string
    {
        return self::callback(self::HISTORY_PREFIX, $leadId);
    }

    public static function leadCallback(string $leadId): string
    {
        return self::callback(self::LEAD_PREFIX, $leadId);
    }

    /** @return array{action:string,leadId:string}|null */
    public static function parseCallback(mixed $value): ?array
    {
        if (!is_string($value)
            || strlen($value) > 64
            || preg_match('/\A(ch1|cl1):(' . self::UUID . ')\z/Di', $value, $match) !== 1
        ) {
            return null;
        }
        return [
            'action' => strtolower($match[1]) === 'ch1' ? 'history' : 'lead',
            'leadId' => strtolower($match[2]),
        ];
    }

    /** @param array<string,mixed> $history */
    public static function history(array $history, int $entryLimit): string
    {
        $summary = is_array($history['summary'] ?? null) ? $history['summary'] : [];
        $entries = is_array($history['entries'] ?? null) ? $history['entries'] : [];
        $lines = [
            '📚 История клиента',
            'Обращений: ' . (int)($summary['matchingLeadCount'] ?? 0),
            'КП: ' . (int)($summary['quoteCount'] ?? 0),
            'Известная сумма: ' . self::money((int)($summary['knownAmountRub'] ?? 0)),
        ];
        $matchedBy = is_array($summary['matchedBy'] ?? null) ? $summary['matchedBy'] : [];
        if ($matchedBy !== []) {
            $labels = array_map(static fn (mixed $kind): string => $kind === 'email' ? 'e-mail' : 'телефон', $matchedBy);
            $lines[] = 'Связь: ' . implode(', ', array_unique($labels));
        }
        $lines[] = '';
        $slice = array_slice($entries, -$entryLimit);
        foreach ($slice as $index => $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $lines[] = ($index + 1) . '. ' . self::date((string)($entry['receivedAt'] ?? ''));
            $lines[] = 'Форма: ' . self::oneLine((string)($entry['formId'] ?? ''), 120);
            $lines[] = 'Страница: ' . self::oneLine((string)($entry['pagePath'] ?? ''), 500);
            if (is_int($entry['amountRub'] ?? null)) {
                $lines[] = 'Сумма: ' . self::money($entry['amountRub']);
            }
            if (is_string($entry['kpNumber'] ?? null) && $entry['kpNumber'] !== '') {
                $lines[] = 'КП: ' . self::oneLine($entry['kpNumber'], 100);
            }
            $journey = is_array($entry['viewed'] ?? null) ? $entry['viewed'] : [];
            $paths = [];
            foreach ($journey as $view) {
                if (is_array($view) && is_string($view['path'] ?? null)) {
                    $paths[] = self::oneLine($view['path'], 120);
                }
            }
            if ($paths !== []) {
                $lines[] = 'Смотрел: ' . implode(' → ', array_slice($paths, -8));
            }
            $lines[] = '';
        }
        if (($history['scan']['truncated'] ?? false) === true || ($summary['entriesTruncated'] ?? false) === true) {
            $lines[] = 'Показана только часть сохранённой истории.';
        }
        return self::limit(implode("\n", $lines));
    }

    /** @return array{text:string,reply_markup:array<string,mixed>} */
    public static function lead(PDO $pdo, string $leadId): array
    {
        $query = $pdo->prepare(<<<'SQL'
SELECT lead_id, tag, fields_json
FROM leads
WHERE lead_id = :lead_id
SQL);
        $query->execute([':lead_id' => $leadId]);
        $row = $query->fetch();
        if (!is_array($row)) {
            throw new RuntimeException('Lead not found');
        }
        try {
            $fields = json_decode((string)$row['fields_json'], true, 32, JSON_THROW_ON_ERROR);
        } catch (JsonException $error) {
            throw new RuntimeException('Lead fields are unreadable', 0, $error);
        }
        if (!is_array($fields) || array_is_list($fields)) {
            throw new RuntimeException('Lead fields are unreadable');
        }
        $lines = ['🔔 Заявка с сайта EGOE'];
        $phone = null;
        foreach ($fields as $name => $value) {
            if (!is_string($name) || !is_string($value)) {
                continue;
            }
            $safeName = self::oneLine($name, 100);
            $safeValue = self::multiLine($value, 1200);
            if ($safeName === '') {
                continue;
            }
            $lines[] = $safeName . ':' . ($safeValue === '' ? '' : ' ' . $safeValue);
            if ($phone === null && preg_match('/тел|phone/iu', $name) === 1) {
                $phone = self::phone($value);
            }
        }
        $keyboard = [];
        if ($phone !== null) {
            $keyboard[] = [[
                'text' => '💬 Написать в WhatsApp',
                'url' => 'https://wa.me/' . ltrim($phone, '+'),
            ]];
        }
        $keyboard[] = [[
            'text' => '📚 История клиента',
            'callback_data' => self::historyCallback($leadId),
        ]];
        return [
            'text' => self::limit(implode("\n", $lines)),
            'reply_markup' => ['inline_keyboard' => $keyboard],
        ];
    }

    private static function callback(string $prefix, string $leadId): string
    {
        $parsed = self::parseCallback($prefix . strtolower(trim($leadId)));
        if ($parsed === null) {
            throw new RuntimeException('Lead ID must be a UUID');
        }
        return $prefix . $parsed['leadId'];
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

    private static function date(string $value): string
    {
        try {
            return (new DateTimeImmutable($value))
                ->setTimezone(new DateTimeZone('Europe/Moscow'))
                ->format('d.m.Y H:i');
        } catch (Throwable) {
            return self::oneLine($value, 40);
        }
    }

    private static function money(int $value): string
    {
        return number_format(max(0, $value), 0, ',', ' ') . ' ₽';
    }

    private static function oneLine(string $value, int $limit): string
    {
        $value = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $value) ?? '';
        return mb_substr(trim((string)preg_replace('/\s+/u', ' ', $value)), 0, $limit, 'UTF-8');
    }

    private static function multiLine(string $value, int $limit): string
    {
        $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value) ?? '';
        $value = preg_replace('/[ \t]+/u', ' ', $value) ?? '';
        $value = preg_replace('/\R{3,}/u', "\n\n", $value) ?? '';
        return mb_substr(trim($value), 0, $limit, 'UTF-8');
    }

    private static function limit(string $value): string
    {
        if (mb_strlen($value, 'UTF-8') <= 4000) {
            return $value;
        }
        return rtrim(mb_substr($value, 0, 3980, 'UTF-8')) . "\n…";
    }
}

final class CallbackHandler
{
    /** @param array<string,mixed> $update
     *  @param array<string,mixed> $settings
     */
    public static function handle(array $update, array $settings, PDO $pdo, BotApi $api): void
    {
        $callback = $update['callback_query'] ?? null;
        if (!is_array($callback) || array_is_list($callback)) {
            return;
        }
        $callbackId = $callback['id'] ?? null;
        if (!is_string($callbackId) || $callbackId === '' || strlen($callbackId) > 256) {
            return;
        }
        $message = $callback['message'] ?? null;
        $from = $callback['from'] ?? null;
        $chat = is_array($message) ? ($message['chat'] ?? null) : null;
        $messageAuthor = is_array($message) ? ($message['from'] ?? null) : null;
        $chatId = self::integerId(is_array($chat) ? ($chat['id'] ?? null) : null);
        $userId = self::integerId(is_array($from) ? ($from['id'] ?? null) : null);
        $authorId = self::integerId(is_array($messageAuthor) ? ($messageAuthor['id'] ?? null) : null);
        $messageId = is_array($message) && is_int($message['message_id'] ?? null)
            ? $message['message_id']
            : null;
        $chatType = is_array($chat) ? ($chat['type'] ?? null) : null;

        if ($chatId === null
            || $userId === null
            || $authorId === null
            || !is_int($messageId)
            || $messageId < 1
            || !in_array($chatType, ['group', 'supergroup'], true)
            || !in_array($chatId, $settings['allowed_chat_ids'], true)
            || !in_array($userId, $settings['allowed_user_ids'], true)
            || !hash_equals((string)$settings['bot_id'], $authorId)
            || (is_array($messageAuthor) ? ($messageAuthor['is_bot'] ?? null) : null) !== true
        ) {
            self::answer($api, $callbackId, 'Недостаточно прав.', true);
            return;
        }

        $parsed = TelegramText::parseCallback($callback['data'] ?? null);
        if ($parsed === null || !self::messageHasCallback($message, (string)$callback['data'])) {
            self::answer($api, $callbackId, 'Кнопка устарела. Обновите сообщение.', true);
            return;
        }

        try {
            if ($parsed['action'] === 'history') {
                $history = CustomerHistory::forLead($pdo, $parsed['leadId'], (string)$settings['identity_key']);
                $text = TelegramText::history($history, (int)$settings['max_history_entries']);
                $markup = ['inline_keyboard' => [[[
                    'text' => '⬅️ Назад к заявке',
                    'callback_data' => TelegramText::leadCallback($parsed['leadId']),
                ]]]];
            } else {
                $lead = TelegramText::lead($pdo, $parsed['leadId']);
                $text = $lead['text'];
                $markup = $lead['reply_markup'];
            }
        } catch (Throwable) {
            self::answer($api, $callbackId, 'История для этой заявки недоступна.', true);
            return;
        }

        try {
            $api->call('editMessageText', [
                'chat_id' => $chatId,
                'message_id' => $messageId,
                'text' => $text,
                'link_preview_options' => ['is_disabled' => true],
                'reply_markup' => $markup,
            ]);
        } catch (BotApiFailure $error) {
            // Telegram may redeliver the same callback after the first edit
            // already succeeded. Treat only its exact idempotency response as OK.
            if (!$error->isMessageNotModified()) {
                throw $error;
            }
        }
        self::answer($api, $callbackId, '', false);
    }

    private static function answer(BotApi $api, string $callbackId, string $text, bool $alert): void
    {
        $parameters = ['callback_query_id' => $callbackId, 'cache_time' => 0];
        if ($text !== '') {
            $parameters['text'] = mb_substr($text, 0, 200, 'UTF-8');
            $parameters['show_alert'] = $alert;
        }
        $api->call('answerCallbackQuery', $parameters);
    }

    /** @param array<string,mixed> $message */
    private static function messageHasCallback(array $message, string $data): bool
    {
        $markup = $message['reply_markup'] ?? null;
        $rows = is_array($markup) ? ($markup['inline_keyboard'] ?? null) : null;
        if (!is_array($rows) || !array_is_list($rows)) {
            return false;
        }
        $seen = 0;
        foreach ($rows as $row) {
            if (!is_array($row) || !array_is_list($row)) {
                continue;
            }
            foreach ($row as $button) {
                $seen += 1;
                if ($seen > 100) {
                    return false;
                }
                if (is_array($button)
                    && is_string($button['callback_data'] ?? null)
                    && hash_equals($data, $button['callback_data'])
                ) {
                    return true;
                }
            }
        }
        return false;
    }

    private static function integerId(mixed $value): ?string
    {
        if (is_int($value)) {
            return (string)$value;
        }
        if (is_string($value) && preg_match('/\A-?[1-9][0-9]{0,19}\z/D', $value) === 1) {
            return $value;
        }
        return null;
    }
}
