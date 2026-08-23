<?php

declare(strict_types=1);

// Copy to <deploy_root>/shared/leads/config.php, keep mode 0600, and replace
// the placeholder with `bin2hex(random_bytes(32))`. Never commit the real file.
return [
    'site_host' => 'www.egoe-life.ru',
    'allowed_hosts' => ['www.egoe-life.ru', 'egoe-life.ru'],
    // Fail closed until legal review, any required RKN update and the state marker.
    'collection_enabled' => false,
    'consent_version' => '2026-08-23',
    'ip_hash_key' => 'REPLACE_WITH_64_HEX_CHARACTERS_OUTSIDE_GIT',
    'minimum_elapsed_ms' => 600,
    'rate_limit' => ['max_requests' => 5, 'window_seconds' => 600],
    'retention_days' => 365,
    'consent_evidence_days' => 1095,
    'backup_retention_days' => 30,
    'relay' => [
        // Default is deliberately OFF. No outbox row or network request is made.
        'enabled' => false,
        'url' => '',
        'mode' => 'signal',
        'allow_signal' => false,
        'allow_technical' => false,
        'allow_full' => false,
        'cross_border_confirmed' => false,
        'timeout_seconds' => 3,
        'ca_file' => '',
    ],
];
