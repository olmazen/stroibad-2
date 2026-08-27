# Daily analytics module

This module builds one server-only digest for the previous Moscow calendar day.
The deployable runtime is deliberately limited to:

- `api/leads/lib/DailyAnalytics.php`;
- `api/leads/cli/daily-report.php`.

Those exact PHP files are allowlisted by `config/site-contract.json`, included
in the immutable `dist/` artifact, and available to cron through
`<deploy_root>/current`. The existing root `.htaccess` returns 404 for every
`/api/leads/lib/` and `/api/leads/cli/` HTTP request. `ops/analytics`, fixtures,
private configuration, receipts, and tests do not enter the public artifact.

The REG.RU runtime needs PHP 8.2 with `sqlite3`, `curl`, `date`, and `json`.
Node.js is used only by repository tests.

## KPI contract

The digest is for a five-person internal operating group, so aggregate counts
are exact by default. `minimum_reportable_count` can still be raised to suppress
small cells when a different receiver requires it.

Primary metrics:

- accepted leads, explicitly labelled as a proxy rather than sales or revenue;
- number of КП requests and the sum of parseable `fields.Итого` values, labelled
  as quoted pipeline rather than revenue;
- remaining accepted forms as the non-КП count (the fixed top-source breakdown
  still distinguishes known regular forms from an `other` safety bucket);
- Yandex organic clicks and CTR when Webmaster is enabled.

Drivers are impressions, average position, searchable pages, and top-three
safe form/page categories. Guardrails are the failed/pending relay backlog and
fatal/critical Webmaster diagnostics. The lead count is compared with the
prior Moscow day.

SQLite is opened with `SQLITE3_OPEN_READONLY` and `PRAGMA query_only`. Aggregate
queries use `received_at`, `form_id`, `page_path`, outbox state, and only the
`$.fields.Итого` scalar extracted from КП `payload_json`. PHP never selects or
emits names, phones, e-mails, free text, lead IDs, per-lead timestamps, IP/HMAC
IP, consent evidence, or attachments. Form/page output is reduced to fixed safe
categories; attacker-controlled raw form IDs and paths cannot enter the digest.

The CLI emits one flat `egoe.daily-analytics.v1` JSON object. Values are scalars
or `null`. `_subject` and `Сообщение` are the presentation fields.

## Private configuration

Prepare persistent storage outside the web root and outside Git as the hosting
runtime user:

```sh
mkdir -p /var/www/u3602289/data/www/egoe-deploy/shared/analytics/receipts
chmod 0700 /var/www/u3602289/data/www/egoe-deploy/shared/analytics
chmod 0700 /var/www/u3602289/data/www/egoe-deploy/shared/analytics/receipts
cp ops/analytics/config.example.php /var/www/u3602289/data/www/egoe-deploy/shared/analytics/config.php
chmod 0600 /var/www/u3602289/data/www/egoe-deploy/shared/analytics/config.php
: > /var/www/u3602289/data/www/egoe-deploy/shared/analytics/cron-errors.log
chmod 0600 /var/www/u3602289/data/www/egoe-deploy/shared/analytics/cron-errors.log
```

The config loader rejects symlinks, any mode other than `0600`, and a file not
owned by the runtime user. The SQLite loader rejects symlinks, foreign owners,
and group/world access. Never place OAuth tokens or receiver URLs in Git,
GitHub variables, the crontab, or the public tree.

Read-only smoke test after a normal approved site deploy:

```sh
/usr/bin/php /var/www/u3602289/data/www/egoe-deploy/current/api/leads/cli/daily-report.php \
  --config /var/www/u3602289/data/www/egoe-deploy/shared/analytics/config.php \
  --date 2026-08-26 \
  --no-yandex \
  --pretty
```

`--input-json PATH` is for fixtures and controlled migrations. Production uses
the persistent SQLite path in the private config.

## Yandex Webmaster access

User-provided credentials are:

1. A Yandex account with confirmed access to `https://www.egoe-life.ru/` in
   Webmaster.
2. A Yandex OAuth application and its Client ID during one-time token issue.
   Follow the [official Webmaster authorization guide](https://www.yandex.ru/dev/webmaster/doc/ru/tasks/how-to-get-oauth).
   The current guide names `webmaster:hostinfo` and `webmaster:verify`; this
   module makes only read calls and never invokes verification/write endpoints.
3. The OAuth access token. The official guide currently states a six-month
   lifetime; record its owner, issue date, and renewal date. Store it only in
   the mode-`0600` config or a private cron environment.

The client obtains `user_id`, lists hosts, and accepts only `verified: true`
hosts matching configured `site_urls`. It reads the
[site summary](https://yandex.ru/dev/webmaster/doc/ru/reference/host-id-summary)
and [all-query history](https://www.yandex.ru/dev/webmaster/doc/ru/reference/host-search-queries-history-all).
No Metrica counter, permission, or API is used.

## Optional GAS → Telegram delivery

`--send` is fail-closed. It requires `delivery.enabled=true`, an exact
`https://script.google.com/macros/s/.../exec` URL, the matching lowercase
SHA-256, and an existing owner-only receipts directory. The request body is
byte-for-byte limited to:

```json
{"_subject":"...","Сообщение":"..."}
```

Internal metric keys never leave the server. TLS certificate/hostname checks
are enabled; HTTP and redirects are rejected; the response must be 2xx JSON
with `{"ok":true}`. A per-date mode-`0600` receipt is written only after that
confirmation. A matching receipt makes a cron retry return `already_sent`
without another request. A lock directory prevents concurrent duplicate sends.
As with any HTTP sender plus local receipt, a process or host failure after the
receiver accepts the request but before the receipt is written can cause a later
retry. The GAS receiver must therefore deduplicate the stable
`Idempotency-Key: egoe-YYYY-MM-DD` value before production activation.

Important: some Apps Script response modes redirect to a Googleusercontent URL.
This sender intentionally rejects that behavior. Confirm that the approved
`doPost` implementation returns direct 2xx JSON before enabling delivery; if it
redirects, leave delivery off and review a different receiver architecture
instead of weakening this control.

## Production handoff and cron

1. Merge only after CI proves both runtime files are in `dist/release.json` and
   `ops/analytics` is absent.
2. Deploy through the normal reviewed release workflow. Do not copy PHP beside
   the release manually.
3. Create the persistent directories/config above and run the read-only smoke
   test against `current`.
4. Configure Webmaster, inspect one local report, then configure the exact GAS
   URL/hash and perform one controlled `--send` test. Verify the two-key body
   and receipt before enabling cron.
5. Install `cron.example` for 09:10 Moscow time. Verify the hosting cron uses
   Moscow scheduling. The cron directly calls the immutable CLI under `current`.

A rollback to a release without the analytics CLI makes cron fail without
sending; it cannot fall back to an old or unreviewed script. Config and receipts
remain under `shared` across release switches.

`run-daily.sh` is an optional staging helper that atomically retains the full
local aggregate under a private outbox; it is not required for production
delivery and is not included in `dist`.

## Tests

```sh
EGOE_PHP_BIN=/path/to/php node --test tools/analytics-digest.test.mjs
```

Tests use temporary SQLite, fixture JSON, and loopback mock HTTP servers. They
assert the exact outbound key allowlist and never call Yandex, GAS, or Telegram.
