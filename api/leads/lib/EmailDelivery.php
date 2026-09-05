<?php

declare(strict_types=1);

namespace Egoe\Email;

use DateTimeImmutable;
use Egoe\Leads\OutboxTransport;
use JsonException;
use PDO;
use RuntimeException;
use Throwable;

interface MailSubmitter
{
    public function submit(
        string $envelopeSender,
        string $envelopeRecipient,
        string $rawMessage,
        int $timeoutSeconds
    ): void;
}

final class SendmailSubmitter implements MailSubmitter
{
    public function __construct(private readonly string $sendmailPath)
    {
        foreach (['proc_open', 'proc_get_status', 'proc_terminate', 'proc_close'] as $function) {
            if (!function_exists($function)) {
                throw new RuntimeException('Local mail transfer capability is unavailable');
            }
        }
    }

    public function submit(
        string $envelopeSender,
        string $envelopeRecipient,
        string $rawMessage,
        int $timeoutSeconds
    ): void {
        if (!hash_equals('zakaz@egoe-life.ru', $envelopeSender)
            || !hash_equals('zakaz@egoe-life.ru', $envelopeRecipient)
            || $timeoutSeconds < 1
            || $timeoutSeconds > 20
            || $rawMessage === ''
        ) {
            throw new RuntimeException('Email submission parameters are invalid');
        }

        $pipes = [];
        $process = @proc_open(
            [$this->sendmailPath, '-oi', '-f', $envelopeSender, '--', $envelopeRecipient],
            [
                0 => ['pipe', 'r'],
                1 => ['pipe', 'w'],
                2 => ['pipe', 'w'],
            ],
            $pipes,
            null,
            null,
            ['bypass_shell' => true]
        );
        if (!is_resource($process)
            || !isset($pipes[0], $pipes[1], $pipes[2])
            || !is_resource($pipes[0])
            || !is_resource($pipes[1])
            || !is_resource($pipes[2])
        ) {
            throw new RuntimeException('Local mail transfer agent is unavailable');
        }

        $deadline = microtime(true) + $timeoutSeconds;
        $closedInput = false;
        $closedProcess = false;
        try {
            stream_set_blocking($pipes[0], false);
            stream_set_blocking($pipes[1], false);
            stream_set_blocking($pipes[2], false);
            $offset = 0;
            $length = strlen($rawMessage);
            while ($offset < $length) {
                if (microtime(true) >= $deadline) {
                    throw new RuntimeException('Local mail transfer agent timed out');
                }
                $written = @fwrite($pipes[0], substr($rawMessage, $offset, 65536));
                if ($written === false) {
                    throw new RuntimeException('Local mail transfer agent rejected the message');
                }
                if ($written === 0) {
                    usleep(10000);
                    continue;
                }
                $offset += $written;
            }
            fclose($pipes[0]);
            $closedInput = true;

            $exitCode = -1;
            while (true) {
                @stream_get_contents($pipes[1], 4096);
                @stream_get_contents($pipes[2], 4096);
                $status = proc_get_status($process);
                if (!is_array($status)) {
                    throw new RuntimeException('Local mail transfer agent status is unavailable');
                }
                if (($status['running'] ?? true) === false) {
                    $exitCode = is_int($status['exitcode'] ?? null) ? $status['exitcode'] : -1;
                    break;
                }
                if (microtime(true) >= $deadline) {
                    @proc_terminate($process);
                    throw new RuntimeException('Local mail transfer agent timed out');
                }
                usleep(10000);
            }
            fclose($pipes[1]);
            fclose($pipes[2]);
            $closed = proc_close($process);
            $closedProcess = true;
            if ($exitCode < 0) {
                $exitCode = $closed;
            }
            if ($exitCode !== 0) {
                throw new RuntimeException('Local mail transfer agent rejected the message');
            }
        } catch (Throwable $error) {
            if (!$closedInput && is_resource($pipes[0])) {
                fclose($pipes[0]);
            }
            foreach ([1, 2] as $pipe) {
                if (isset($pipes[$pipe]) && is_resource($pipes[$pipe])) {
                    fclose($pipes[$pipe]);
                }
            }
            if (!$closedProcess && is_resource($process)) {
                self::terminate($process);
            }
            throw $error;
        }
    }

    /** @param resource $process */
    private static function terminate($process): void
    {
        $status = proc_get_status($process);
        if (is_array($status) && ($status['running'] ?? false) === true) {
            @proc_terminate($process);
            for ($attempt = 0; $attempt < 25; $attempt += 1) {
                usleep(10000);
                $status = proc_get_status($process);
                if (!is_array($status) || ($status['running'] ?? false) === false) {
                    break;
                }
            }
            if (is_array($status) && ($status['running'] ?? false) === true) {
                @proc_terminate($process, 9);
                for ($attempt = 0; $attempt < 25; $attempt += 1) {
                    usleep(10000);
                    $status = proc_get_status($process);
                    if (!is_array($status) || ($status['running'] ?? false) === false) {
                        break;
                    }
                }
            }
        }
        @proc_close($process);
    }
}

final class EmailLeadTransport implements OutboxTransport
{
    private const MAILBOX = 'zakaz@egoe-life.ru';
    private const SENDER_NAME = 'EGOE — сайт';

    /** @param array<string,mixed> $settings */
    public function __construct(
        private readonly array $settings,
        private readonly ?MailSubmitter $submitter
    ) {
        if ($this->enabled()) {
            if ($this->submitter === null
                || !hash_equals(self::MAILBOX, (string)($this->settings['recipient'] ?? ''))
                || !hash_equals(self::MAILBOX, (string)($this->settings['sender'] ?? ''))
                || !hash_equals(self::SENDER_NAME, (string)($this->settings['sender_name'] ?? ''))
            ) {
                throw new RuntimeException('Email lead transport configuration is invalid');
            }
        }
    }

    /** @param array<string,mixed> $settings */
    public static function production(array $settings): self
    {
        $submitter = ($settings['enabled'] ?? false) === true
            ? new SendmailSubmitter((string)($settings['sendmail_path'] ?? ''))
            : null;
        return new self($settings, $submitter);
    }

    public function enabled(): bool
    {
        return ($this->settings['enabled'] ?? false) === true;
    }

    public function mode(): string
    {
        return 'email';
    }

    public function payload(array $lead): array
    {
        $leadId = strtolower((string)($lead['leadId'] ?? ''));
        self::assertLeadId($leadId);
        return [
            'schemaVersion' => 1,
            'kind' => 'email-lead',
            'leadId' => $leadId,
        ];
    }

    public function deliver(PDO $pdo, string $leadId, string $payloadJson): void
    {
        if (!$this->enabled() || $this->submitter === null) {
            throw new RuntimeException('Email lead transport is disabled');
        }
        self::assertLeadId($leadId);
        try {
            $payload = json_decode($payloadJson, true, 8, JSON_THROW_ON_ERROR);
        } catch (JsonException $error) {
            throw new RuntimeException('Email outbox payload is invalid', 0, $error);
        }
        if (!is_array($payload)
            || array_is_list($payload)
            || array_keys($payload) !== ['schemaVersion', 'kind', 'leadId']
            || ($payload['schemaVersion'] ?? null) !== 1
            || ($payload['kind'] ?? null) !== 'email-lead'
            || !is_string($payload['leadId'] ?? null)
            || !hash_equals(strtolower($leadId), strtolower($payload['leadId']))
        ) {
            throw new RuntimeException('Email outbox payload is invalid');
        }

        $message = EmailMessage::forLead($pdo, strtolower($leadId));
        $this->submitter->submit(
            self::MAILBOX,
            self::MAILBOX,
            $message,
            (int)($this->settings['timeout_seconds'] ?? 0)
        );
    }

    private static function assertLeadId(string $leadId): void
    {
        if (preg_match('/\A[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/Di', $leadId) !== 1) {
            throw new RuntimeException('Email lead ID is invalid');
        }
    }
}

final class EmailMessage
{
    public static function forLead(PDO $pdo, string $leadId): string
    {
        $query = $pdo->prepare('SELECT lead_id, received_at, fields_json FROM leads WHERE lead_id = :lead_id');
        $query->execute([':lead_id' => strtolower($leadId)]);
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

        $textLines = ['Заявка с сайта EGOE'];
        $htmlRows = [];
        foreach ($fields as $name => $value) {
            if (!is_string($name) || !is_string($value)) {
                throw new RuntimeException('Lead fields are unreadable');
            }
            $safeName = self::oneLine($name);
            $safeValue = self::multiLine($value);
            if ($safeName === '') {
                throw new RuntimeException('Lead fields are unreadable');
            }
            $textLines[] = $safeName . ':' . ($safeValue === '' ? '' : ' ' . $safeValue);
            $htmlRows[] = '<tr><th align="left" valign="top">'
                . self::html($safeName)
                . '</th><td valign="top">'
                . nl2br(self::html($safeValue), false)
                . '</td></tr>';
        }

        try {
            $date = (new DateTimeImmutable((string)$row['received_at']))->format(DATE_RFC2822);
        } catch (Throwable $error) {
            throw new RuntimeException('Lead timestamp is unreadable', 0, $error);
        }
        $normalizedLeadId = strtolower((string)$row['lead_id']);
        $boundary = '=_egoe_' . substr(hash('sha256', $normalizedLeadId), 0, 40);
        $encodedSender = '=?UTF-8?B?' . base64_encode('EGOE — сайт') . '?=';
        $encodedSubject = '=?UTF-8?B?' . base64_encode('Новая заявка с сайта EGOE') . '?=';
        $plain = implode("\n", $textLines) . "\n";
        $html = '<!doctype html><html lang="ru"><body><h1>Заявка с сайта EGOE</h1><table>'
            . implode('', $htmlRows)
            . '</table></body></html>';

        $headers = [
            'Date: ' . $date,
            'From: ' . $encodedSender . ' <zakaz@egoe-life.ru>',
            'To: zakaz@egoe-life.ru',
            'Subject: ' . $encodedSubject,
            'Message-ID: <' . $normalizedLeadId . '.email@egoe-life.ru>',
            'MIME-Version: 1.0',
            'Auto-Submitted: auto-generated',
            'X-Auto-Response-Suppress: All',
            'Content-Type: multipart/alternative; boundary="' . $boundary . '"',
        ];
        $parts = [
            '--' . $boundary,
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: base64',
            '',
            self::base64($plain),
            '--' . $boundary,
            'Content-Type: text/html; charset=UTF-8',
            'Content-Transfer-Encoding: base64',
            '',
            self::base64($html),
            '--' . $boundary . '--',
            '',
        ];
        return implode("\r\n", $headers) . "\r\n\r\n" . implode("\r\n", $parts);
    }

    private static function oneLine(string $value): string
    {
        $value = self::multiLine($value);
        $value = preg_replace('/\s+/u', ' ', $value);
        return trim(is_string($value) ? $value : '');
    }

    private static function multiLine(string $value): string
    {
        $value = str_replace(["\r\n", "\r"], "\n", $value);
        $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', ' ', $value);
        return trim(is_string($value) ? $value : '');
    }

    private static function html(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
    }

    private static function base64(string $value): string
    {
        return rtrim(chunk_split(base64_encode($value), 76, "\r\n"), "\r\n");
    }
}
