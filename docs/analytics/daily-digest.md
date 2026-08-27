# EGOE daily digest: metric and delivery contract

Status: runtime implemented and tested; production config, OAuth, GAS approval,
controlled send, and cron activation remain explicit operator steps.

## Decision frame

The five-person operating group needs one morning answer: how many requests
were accepted, what quoted pipeline entered, whether organic discovery moved,
and whether delivery/indexing needs attention. SQLite accepted leads are only a
proxy until CRM qualification and won/lost revenue exist. `Итого` is quoted
pipeline, not booked revenue.

| Role | Metric | Definition / source |
|---|---|---|
| Primary proxy | Accepted leads | Count of SQLite `leads.received_at` in the Moscow day |
| Primary | КП pipeline | Count of `cart:quote`; sum of strictly numeric `fields.Итого` |
| Primary | Organic response | Webmaster clicks and CTR for the report date |
| Breakdown | Remaining forms | Accepted leads excluding `cart:quote`; not the stricter safe-source `regular` bucket |
| Driver | Demand/discovery | Impressions, average show position, searchable pages |
| Driver | Source mix | Top three fixed form types and page-section buckets |
| Guardrail | Delivery | Sent during report day; current failed/pending backlog |
| Guardrail | Search health | Fatal/critical Webmaster problem counts |

The digest also compares accepted leads with the previous Moscow day. No target
is encoded yet because there is no reviewed historical baseline or sales
qualification source.

## Data boundary

- Full leads remain in the persistent Russian SQLite database.
- The aggregate reader is read-only and never emits names, phones, e-mails,
  messages, IDs, raw paths/form IDs, IP data, or consent evidence.
- Safe source labels come from a closed category map.
- Exact aggregate counts are the internal default; optional small-cell
  suppression applies consistently to totals, source cells, comparisons, and
  pipeline visibility.
- Yandex Webmaster is optional and read-only. Metrica is absent.

`schema=egoe.daily-analytics.v1` is a flat local record. It contains identity,
date/source/policy fields; lead/pipeline/comparison fields; safe top-source
strings; outbox guardrails; Webmaster status/search/indexing fields; and the two
presentation fields `_subject` and `Сообщение`.

## External boundary

Without `--send`, the CLI makes no GAS/Telegram call. With an approved private
delivery config, `--send` posts only `_subject` and `Сообщение`; all other flat
fields stay local. The URL is HTTPS/GAS allowlisted and SHA-256 pinned, redirects
are disabled, `{"ok":true}` is mandatory, and a private per-date receipt plus
atomic lock prevents concurrent and ordinary retry duplicates. A failure after
the receiver accepts the request but before the local receipt is written is the
unavoidable cross-system gap, so the receiver must deduplicate the stable
`Idempotency-Key: egoe-YYYY-MM-DD` header before production activation.

Before activation, record the REG.RU paths/owners/modes, successful PHP/SQLite
smoke test, Yandex account/app/scopes/token dates, exact GAS URL hash, direct
non-redirecting response behavior, Telegram access list/retention, controlled
two-key payload capture, receipt, fixed 09:10 Moscow schedule, and operational
owner for failures/token renewal.
