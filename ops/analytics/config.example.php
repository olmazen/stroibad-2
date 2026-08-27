<?php

declare(strict_types=1);

// Copy this file to:
// /var/www/u3602289/data/www/egoe-deploy/shared/analytics/config.php
// Keep the directory mode 0700 and this file mode 0600. Never commit the copy.
return [
    'timezone' => 'Europe/Moscow',
    'leads' => [
        'source' => 'sqlite',
        'sqlite_path' => '/var/www/u3602289/data/www/egoe-deploy/shared/leads/leads.sqlite3',
        'json_path' => '',
    ],
    'privacy' => [
        // Exact aggregates are useful to the five-person internal group.
        // Raise above 1 only when the receiver requires small-cell suppression.
        'minimum_reportable_count' => 1,
    ],
    'yandex_webmaster' => [
        'enabled' => false,
        // Prefer the environment variable. If the hosting cannot provide a private
        // cron environment, put the token only in the mode-0600 server copy here.
        'oauth_token_env' => 'EGOE_YANDEX_WEBMASTER_TOKEN',
        'oauth_token' => '',
        'api_base_url' => 'https://api.webmaster.yandex.net/v4',
        // Host discovery considers only verified hosts and follows this order.
        'site_urls' => [
            'https://www.egoe-life.ru/',
            'https://egoe-life.ru/',
        ],
        // Leave empty for verified-host auto-discovery. Set only if the account
        // contains more than one verified representation of the same site.
        'host_id' => '',
        'timeout_seconds' => 10,
    ],
    'delivery' => [
        // Keep OFF until the exact GAS receiver and external route are approved.
        'enabled' => false,
        // HTTPS GAS /exec URL. Store it only in the private server copy.
        'url' => '',
        // Lowercase SHA-256 of the exact URL above.
        'url_sha256' => '',
        // Pre-create this directory as the runtime user with mode 0700.
        'receipts_dir' => '/var/www/u3602289/data/www/egoe-deploy/shared/analytics/receipts',
        'timeout_seconds' => 10,
    ],
];
