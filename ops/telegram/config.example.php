<?php

declare(strict_types=1);

// Copy to <deploy_root>/shared/telegram/config.php. Keep both the directory and
// this file outside Git with modes 0700 and 0600. Store IDs as quoted strings.
return [
    // This flag is necessary but not sufficient. Activation also requires the
    // independent mode-0600 state/telegram-history-approved marker containing
    // exactly "egoe-life.ru" with no trailing newline.
    'enabled' => false,
    // Direct server delivery additionally requires its own mode-0600
    // state/telegram-delivery-approved marker. Google Apps Script is not used.
    'send_leads' => false,
    'bot_token' => 'REPLACE_WITH_BOTFATHER_TOKEN',
    'webhook_secret' => 'REPLACE_WITH_RANDOM_32_TO_256_CHAR_SECRET',
    'delivery_chat_id' => '-1000000000000',
    'allowed_chat_ids' => [
        '-1000000000000',
    ],
    'allowed_user_ids' => [
        '100000000',
    ],
    'timeout_seconds' => 5,
    'max_history_entries' => 10,
];
