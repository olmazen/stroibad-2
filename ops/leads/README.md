# Lead runtime

Production writes first to `<deploy_root>/shared/leads/leads.sqlite3`. The
directory, database, backups and `config.php` are persistent and never enter a
release artifact or Git. The browser checks `/api/leads/status/` and only posts
to `/api/leads/` after the server confirms that collection is enabled.

Collection is fail-closed until the responsible person completes and records
the legal review of the website processing workflow. `collection_enabled` defaults to `false`. Setting
it to `true` is not sufficient: the runtime also requires a regular,
non-symlink `<deploy_root>/state/collection-approved` file whose complete byte
content is exactly `egoe-life.ru` (with no newline or spaces). Create that marker
only after the responsible person records the decision on whether the existing
RKN entry is sufficient and completes any update that decision requires. The
deploy root, `state` directory and marker must have the same owner; neither
`state` nor the marker may be group/world-writable (typical modes `0755` and
`0644` or `0600` are accepted). A missing, malformed, unsafe or symlinked
marker keeps the public status
`{"enabled":false}` and every POST returns `COLLECTION_DISABLED` without
opening SQLite or writing a row. Relay remains independently disabled.

From an immutable release:

```sh
php api/leads/cli/leads.php init
php api/leads/cli/leads.php health
php api/leads/cli/leads.php retry 20
php api/leads/cli/leads.php recent 20
php api/leads/cli/leads.php view 00000000-0000-4000-8000-000000000000
php api/leads/cli/leads.php backup
php api/leads/cli/leads.php retention
php api/leads/cli/leads.php delete 00000000-0000-4000-8000-000000000000
php api/leads/cli/leads.php delete 00000000-0000-4000-8000-000000000000 --with-evidence
```

With relay disabled, run `php api/leads/cli/leads.php recent 20` to poll for
new applications manually. It returns newest-first JSON containing only
`lead_id`, `received_at`, `form_id` and `page_path`; use `view <uuid>` only for
an application an authorized operator needs to process. The optional limit is
1–100 and defaults to 20.

`init` creates a private random HMAC key and leaves every relay mode disabled.
Enabling even an anonymous signal requires explicit server-only flags; technical
or full modes additionally require their dedicated flag. The relay URL belongs
only in persistent `config.php`.

The preferred notification channel is the separately gated direct Telegram
transport in `shared/telegram/config.php`; it uses the same `outbox` and
`leads.php retry` command without Google Apps Script. Legacy relay and direct
Telegram delivery are mutually exclusive at runtime.

Email duplication is a second, independent channel. It submits a multipart
text/HTML copy through the local REG.RU `/usr/sbin/sendmail` (Exim) with the
fixed envelope and headers `zakaz@egoe-life.ru`; user-entered values are never
used in mail headers. The body contains only the form field names and values.
Journey, referrer, IP hash, consent evidence and attachments are excluded.

Email is fail-closed unless all fixed values in the private
`shared/leads/config.php` `email` block are valid, `enabled` is `true`, and the
regular non-symlink `state/email-delivery-approved` marker has exact bytes
`egoe-life.ru`, the deploy owner and mode `0600`. Run `health` after creating
the marker and require `emailDeliveryEnabled: true`. To disable the channel,
remove the marker first, verify `emailDeliveryEnabled: false`, then set the
config flag to `false`.

New-consent leads create `outbox` and `email_outbox` rows in the same SQLite
acceptance transaction. The queues claim, retry and complete independently, so
an Exim failure cannot resend a Telegram notification. The existing
`leads.php retry 20` cron services both queues; do not add a separate email
cron. Schema `user_version` remains `2`, old releases ignore the additional
table, and migration never backfills earlier leads. A successful sendmail exit
only confirms that the local MTA accepted the message for delivery, not that it
reached the inbox.

Rotate `ip_hash_key` at least yearly and immediately after suspected disclosure:
replace it atomically with a new `bin2hex(random_bytes(32))` value and run
`health`. Existing keyed hashes expire with their lead records and cannot be
reversed or recomputed; the key itself is never stored in SQLite or backups.

Suggested cron after `health` passes:

```cron
*/2 * * * * cd /var/www/u3602289/data/www/egoe-deploy/current && /usr/bin/php api/leads/cli/leads.php retry 20 >/dev/null 2>&1
17 3 * * * cd /var/www/u3602289/data/www/egoe-deploy/current && /usr/bin/php api/leads/cli/leads.php retention >/dev/null 2>&1
```

The retention command itself appends a mode-`0600` `lifecycle.log` with only
timestamps/counts, not lead fields. Review it when preparing the destruction
register and rotate it yearly. Backups use the SQLite online-backup API rather
than `VACUUM INTO`, so the verified procedure also works with REG.RU SQLite
3.26 while preserving a consistent snapshot of the WAL database.
