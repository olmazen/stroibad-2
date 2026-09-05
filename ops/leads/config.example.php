<?php

declare(strict_types=1);

// Copy to <deploy_root>/shared/leads/config.php, keep mode 0600, and replace
// the placeholder with `bin2hex(random_bytes(32))`. Never commit the real file.
return [
    'site_host' => 'www.egoe-life.ru',
    'allowed_hosts' => ['www.egoe-life.ru', 'egoe-life.ru'],
    // Fail closed until legal review, any required RKN update and the state marker.
    'collection_enabled' => false,
    'consent_version' => '2026-09-04',
    'ip_hash_key' => 'REPLACE_WITH_64_HEX_CHARACTERS_OUTSIDE_GIT',
    'minimum_elapsed_ms' => 600,
    'rate_limit' => ['max_requests' => 5, 'window_seconds' => 600],
    'retention_days' => 365,
    'consent_evidence_days' => 1095,
    'backup_retention_days' => 30,
    'email' => [
        // Local REG.RU Exim delivery. Enabling also requires the private
        // state/email-delivery-approved marker with exact bytes "egoe-life.ru".
        'enabled' => false,
        'recipient' => 'zakaz@egoe-life.ru',
        'sender' => 'zakaz@egoe-life.ru',
        'sender_name' => 'EGOE — сайт',
        'sendmail_path' => '/usr/sbin/sendmail',
        'timeout_seconds' => 10,
    ],
    'relay' => [
        // Default is deliberately OFF. Enabling also requires state/relay-approved
        // with the exact bytes "egoe-life.ru", deploy owner and mode 0600.
        'enabled' => false,
        'url' => '',
        'mode' => 'signal',
        'allow_signal' => false,
        'allow_technical' => false,
        'allow_full' => false,
        'cross_border_confirmed' => false,
        'timeout_seconds' => 3,
        'ca_file' => '',
        // SHA-256 of the exact approved relay URL; never place the real URL in Git.
        'url_sha256' => 'REPLACE_WITH_APPROVED_RELAY_URL_SHA256',
        // Require the relay response body to be valid JSON with {"ok": true}.
        'require_json_ok' => true,
    ],
];
