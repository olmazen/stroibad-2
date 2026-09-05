<?php

declare(strict_types=1);

use Egoe\Email\EmailLeadTransport;
use Egoe\Email\MailSubmitter;
use Egoe\Email\SendmailSubmitter;
use Egoe\Leads\Database;
use Egoe\Leads\LeadStore;
use Egoe\Leads\Outbox;
use Egoe\Leads\OutboxTransport;
use Egoe\Leads\Runtime;
use Egoe\Leads\Settings;
use Egoe\Leads\Validator;

require dirname(__DIR__) . '/api/leads/lib/LeadBackend.php';
require dirname(__DIR__) . '/api/leads/lib/EmailDelivery.php';

function check(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

final class HarnessSubmitter implements MailSubmitter
{
    public int $attempts = 0;

    /** @var list<array{sender:string,recipient:string,message:string,timeout:int}> */
    public array $messages = [];

    public function __construct(private bool $failNext = true)
    {
    }

    public function submit(
        string $envelopeSender,
        string $envelopeRecipient,
        string $rawMessage,
        int $timeoutSeconds
    ): void {
        $this->attempts += 1;
        $this->messages[] = [
            'sender' => $envelopeSender,
            'recipient' => $envelopeRecipient,
            'message' => $rawMessage,
            'timeout' => $timeoutSeconds,
        ];
        if ($this->failNext) {
            $this->failNext = false;
            throw new RuntimeException('synthetic MTA failure');
        }
    }
}

final class HarnessPrimaryTransport implements OutboxTransport
{
    public int $deliveries = 0;

    public function enabled(): bool
    {
        return true;
    }

    public function mode(): string
    {
        return 'telegram';
    }

    public function payload(array $lead): array
    {
        return [
            'schemaVersion' => 1,
            'kind' => 'telegram-lead',
            'leadId' => strtolower((string)$lead['leadId']),
        ];
    }

    public function deliver(PDO $pdo, string $leadId, string $payloadJson): void
    {
        $payload = json_decode($payloadJson, true, 8, JSON_THROW_ON_ERROR);
        if (!is_array($payload) || !hash_equals($leadId, (string)($payload['leadId'] ?? ''))) {
            throw new RuntimeException('primary payload mismatch');
        }
        $this->deliveries += 1;
    }
}

final class HarnessBrokenEmailTransport implements OutboxTransport
{
    public function enabled(): bool
    {
        return true;
    }

    public function mode(): string
    {
        return 'email';
    }

    public function payload(array $lead): array
    {
        throw new RuntimeException('synthetic payload failure');
    }

    public function deliver(PDO $pdo, string $leadId, string $payloadJson): void
    {
        throw new RuntimeException('unreachable');
    }
}

/** @param array<string,mixed> $settings
 *  @return array<string,mixed>
 */
function lead(array $settings, string $leadId, string $consentVersion, bool $withJourney = true): array
{
    $now = Runtime::utcNow();
    return Validator::payload([
        'schemaVersion' => 1,
        'leadId' => $leadId,
        'formId' => 'system-test:email-duplication',
        'tag' => 'НЕ ДОЛЖНО ПОПАСТЬ В ТЕМУ',
        'createdAt' => $now,
        'consent' => [
            'accepted' => true,
            'version' => $consentVersion,
            'acceptedAt' => $now,
            'documentUrl' => 'https://www.egoe-life.ru/consent/',
        ],
        'page' => [
            'url' => 'https://www.egoe-life.ru/system-test/?private=query',
            'title' => 'Системный тест',
            'referrer' => 'https://referrer.example.invalid/secret',
        ],
        'spamCheck' => ['website' => '', 'elapsedMs' => 1000],
        'fields' => [
            'Имя' => 'Екатерина',
            'Телефон' => '+7 927 229-58-28',
            'E-mail' => 'client.test@example.invalid',
            'Компания' => '',
            'Позиции' => 'Скамейка «Дуга» — 3 шт',
            'Комментарий' => '<img src="https://tracker.example.invalid/pixel">',
        ],
        'journey' => $withJourney ? [[
            'path' => '/secret-journey/',
            'title' => 'СЕКРЕТНЫЙ-МАРШРУТ',
            'viewedAt' => $now,
        ]] : [],
    ], $settings);
}

/** @return list<string> */
function decodedMimeBodies(string $message): array
{
    preg_match_all(
        '/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+\/=\r\n]+?)(?=\r\n--=_egoe_)/s',
        $message,
        $matches
    );
    return array_map(
        static fn (string $encoded): string => (string)base64_decode(str_replace(["\r", "\n"], '', $encoded), true),
        $matches[1] ?? []
    );
}

$root = Runtime::deployRoot();
$settings = Settings::load($root);
check(($settings['email']['enabled'] ?? false) === true, 'email approval marker did not enable delivery');
check(Settings::isCurrentConsentVersion('2026-09-04'), 'current consent mismatch');
check(Settings::isPrimaryDeliveryConsentVersion('2026-08-27'), 'cached consent must remain primary-delivery eligible');
check(!Settings::isEmailDeliveryConsentVersion('2026-08-27'), 'cached consent must not become email eligible');
check(!Settings::isPrimaryDeliveryConsentVersion('2026-08-23'), 'old consent must remain local only');

$pdo = Database::connect($root);
check((int)$pdo->query('PRAGMA user_version')->fetchColumn() === 2, 'schema user_version changed');
Database::assertSchema($pdo);

$primary = new HarnessPrimaryTransport();
$submitter = new HarnessSubmitter();
$email = new EmailLeadTransport($settings['email'], $submitter);
$ipHash = hash_hmac('sha256', '127.0.0.1', (string)$settings['ip_hash_key']);

$preEmailId = '10000000-0000-4000-8000-000000000001';
LeadStore::accept($pdo, lead($settings, $preEmailId, '2026-09-04'), $settings, $ipHash, [$primary]);
Database::migrate($pdo);
$query = $pdo->prepare('SELECT COUNT(*) FROM email_outbox WHERE lead_id = :lead_id');
$query->execute([':lead_id' => $preEmailId]);
check((int)$query->fetchColumn() === 0, 'schema migration backfilled an existing lead');

$leadId = '20000000-0000-4000-8000-000000000002';
$currentLead = lead($settings, $leadId, '2026-09-04');
$accepted = LeadStore::accept($pdo, $currentLead, $settings, $ipHash, [$primary, $email]);
check($accepted['duplicate'] === false, 'new lead reported duplicate');

$queue = $pdo->prepare('SELECT payload_json, status, attempts FROM email_outbox WHERE lead_id = :lead_id');
$queue->execute([':lead_id' => $leadId]);
$emailRow = $queue->fetch();
check(is_array($emailRow), 'email outbox row missing');
check(
    json_decode((string)$emailRow['payload_json'], true, 8, JSON_THROW_ON_ERROR) === [
        'schemaVersion' => 1,
        'kind' => 'email-lead',
        'leadId' => $leadId,
    ],
    'email outbox contains more than the minimal lead reference'
);
check(!str_contains((string)$emailRow['payload_json'], 'Екатерина'), 'email outbox duplicated personal data');

check(Outbox::retryLead($pdo, $primary, $leadId) === ['sent' => 1, 'failed' => 0], 'primary immediate delivery failed');
check(Outbox::retryLead($pdo, $email, $leadId) === ['sent' => 0, 'failed' => 1], 'email failure was not isolated');
check($primary->deliveries === 1, 'email failure duplicated primary delivery');
$pdo->prepare("UPDATE email_outbox SET next_attempt_at = '2000-01-01T00:00:00.000Z' WHERE lead_id = :lead_id")
    ->execute([':lead_id' => $leadId]);
check(Outbox::retryLead($pdo, $email, $leadId) === ['sent' => 1, 'failed' => 0], 'email retry did not recover');
check(Outbox::retryLead($pdo, $email, $leadId) === ['sent' => 0, 'failed' => 0], 'sent email was duplicated on a normal retry');
check($submitter->attempts === 2, 'unexpected email submission count');
check($submitter->messages[0]['message'] === $submitter->messages[1]['message'], 'email retry was not deterministic');
check($submitter->messages[1]['sender'] === 'zakaz@egoe-life.ru', 'envelope sender mismatch');
check($submitter->messages[1]['recipient'] === 'zakaz@egoe-life.ru', 'envelope recipient mismatch');

$rawMessage = $submitter->messages[1]['message'];
[$header] = explode("\r\n\r\n", $rawMessage, 2);
check(str_contains($header, 'From: =?UTF-8?B?' . base64_encode('EGOE — сайт') . '?= <zakaz@egoe-life.ru>'), 'fixed From header missing');
check(str_contains($header, 'To: zakaz@egoe-life.ru'), 'fixed To header missing');
check(str_contains($header, 'Subject: =?UTF-8?B?' . base64_encode('Новая заявка с сайта EGOE') . '?='), 'fixed subject missing');
check(str_contains($header, 'Message-ID: <' . $leadId . '.email@egoe-life.ru>'), 'deterministic Message-ID missing');
check(!str_contains(strtolower($header), 'reply-to:'), 'customer Reply-To must not be present');
check(!str_contains($header, 'client.test@example.invalid'), 'customer email leaked into headers');
check(!str_contains($header, '+7 927'), 'customer phone leaked into headers');
check(!str_contains($header, 'НЕ ДОЛЖНО'), 'lead tag leaked into headers');
check(!str_contains(strtolower($rawMessage), 'content-disposition:'), 'email attachments must remain disabled');

$bodies = decodedMimeBodies($rawMessage);
check(count($bodies) === 2, 'multipart alternative bodies are invalid');
[$plainBody, $htmlBody] = $bodies;
foreach (['Имя: Екатерина', 'Телефон: +79272295828', 'E-mail: client.test@example.invalid', 'Компания:'] as $expected) {
    check(str_contains($plainBody, $expected), "plain email field missing: {$expected}");
}
check(str_contains($htmlBody, '<h1>Заявка с сайта EGOE</h1>'), 'HTML email heading missing');
check(str_contains($htmlBody, '&lt;img src=&quot;https://tracker.example.invalid/pixel&quot;&gt;'), 'customer HTML was not escaped');
check(!str_contains($htmlBody, '<img'), 'remote image markup must not be generated');
$visibleBodies = implode("\n", $bodies);
foreach (['СЕКРЕТНЫЙ-МАРШРУТ', '/secret-journey/', 'referrer.example.invalid', '/consent/', $leadId, 'system-test:email-duplication'] as $forbidden) {
    check(!str_contains($visibleBodies, $forbidden), "excluded metadata leaked into email body: {$forbidden}");
}

$duplicate = LeadStore::accept($pdo, $currentLead, $settings, $ipHash, [$primary, $email]);
check($duplicate['duplicate'] === true, 'idempotent lead retry was not recognized');
$queue->execute([':lead_id' => $leadId]);
check(is_array($queue->fetch()), 'idempotent retry removed email queue state');

$cachedId = '30000000-0000-4000-8000-000000000003';
LeadStore::accept($pdo, lead($settings, $cachedId, '2026-08-27'), $settings, $ipHash, [$primary, $email]);
$query->execute([':lead_id' => $cachedId]);
check((int)$query->fetchColumn() === 0, 'cached 2026-08-27 consent enqueued email');
$primaryRow = $pdo->prepare('SELECT COUNT(*) FROM outbox WHERE lead_id = :lead_id');
$primaryRow->execute([':lead_id' => $cachedId]);
check((int)$primaryRow->fetchColumn() === 1, 'cached 2026-08-27 consent lost primary delivery');

$pdo->prepare(<<<'SQL'
INSERT INTO email_outbox (lead_id, mode, payload_json, next_attempt_at, created_at)
VALUES (:lead_id, 'email', :payload, '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z')
SQL)->execute([
    ':lead_id' => $cachedId,
    ':payload' => json_encode(['schemaVersion' => 1, 'kind' => 'email-lead', 'leadId' => $cachedId], JSON_THROW_ON_ERROR),
]);
check(Outbox::retry($pdo, $email, 20) === ['sent' => 0, 'failed' => 0], 'stale cached email queue was delivered');
$query->execute([':lead_id' => $cachedId]);
check((int)$query->fetchColumn() === 0, 'stale cached email queue was not purged');

$localId = '40000000-0000-4000-8000-000000000004';
LeadStore::accept($pdo, lead($settings, $localId, '2026-08-23', false), $settings, $ipHash, [$primary, $email]);
$query->execute([':lead_id' => $localId]);
$primaryRow->execute([':lead_id' => $localId]);
check((int)$query->fetchColumn() === 0 && (int)$primaryRow->fetchColumn() === 0, '2026-08-23 consent escaped local-only storage');

$brokenId = '50000000-0000-4000-8000-000000000005';
try {
    LeadStore::accept($pdo, lead($settings, $brokenId, '2026-09-04'), $settings, $ipHash, [$primary, new HarnessBrokenEmailTransport()]);
    throw new RuntimeException('broken fanout unexpectedly succeeded');
} catch (RuntimeException $error) {
    check($error->getMessage() === 'synthetic payload failure', 'unexpected fanout failure');
}
$exists = $pdo->prepare('SELECT COUNT(*) FROM leads WHERE lead_id = :lead_id');
$exists->execute([':lead_id' => $brokenId]);
check((int)$exists->fetchColumn() === 0, 'fanout failure left a partially accepted lead');

$pdo->prepare('DELETE FROM leads WHERE lead_id = :lead_id')->execute([':lead_id' => $leadId]);
$query->execute([':lead_id' => $leadId]);
$primaryRow->execute([':lead_id' => $leadId]);
check((int)$query->fetchColumn() === 0 && (int)$primaryRow->fetchColumn() === 0, 'lead deletion did not cascade to both outboxes');

$captureArgs = getenv('EGOE_SENDMAIL_CAPTURE_ARGS');
$captureMessage = getenv('EGOE_SENDMAIL_CAPTURE_MESSAGE');
check(is_string($captureArgs) && $captureArgs !== '' && is_string($captureMessage) && $captureMessage !== '', 'sendmail capture paths missing');
$realSubmitter = new SendmailSubmitter((string)$settings['email']['sendmail_path']);
$realSubmitter->submit('zakaz@egoe-life.ru', 'zakaz@egoe-life.ru', "To: zakaz@egoe-life.ru\r\n\r\nprobe\r\n", 2);
check(file_get_contents($captureArgs) === "-oi\n-f\nzakaz@egoe-life.ru\n--\nzakaz@egoe-life.ru\n", 'sendmail argv is not fixed and shell-free');
check(file_get_contents($captureMessage) === "To: zakaz@egoe-life.ru\r\n\r\nprobe\r\n", 'sendmail stdin changed');

$hangingSendmail = getenv('EGOE_HANGING_SENDMAIL');
check(is_string($hangingSendmail) && $hangingSendmail !== '', 'hanging sendmail path missing');
$startedAt = microtime(true);
try {
    (new SendmailSubmitter($hangingSendmail))->submit(
        'zakaz@egoe-life.ru',
        'zakaz@egoe-life.ru',
        "To: zakaz@egoe-life.ru\r\n\r\nprobe\r\n",
        1
    );
    throw new RuntimeException('hanging sendmail unexpectedly succeeded');
} catch (RuntimeException $error) {
    check($error->getMessage() === 'Local mail transfer agent timed out', 'unexpected timeout failure');
}
check(microtime(true) - $startedAt < 2.5, 'sendmail timeout was not bounded');

echo json_encode([
    'ok' => true,
    'schemaVersion' => (int)$pdo->query('PRAGMA user_version')->fetchColumn(),
    'emailAttempts' => $submitter->attempts,
    'primaryDeliveries' => $primary->deliveries,
], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
