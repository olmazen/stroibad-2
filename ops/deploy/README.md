# REG.RU production deployment

GitHub Pages is staging. This production path is deliberately manual and only accepts the exact artifact preserved by a successful `.github/workflows/pages.yml` run from `main`.

## GitHub environment

Create an environment named `production` and require approval before jobs can use it.

Variables:

- `REG_SSH_HOST` — `server61.hosting.reg.ru`;
- `REG_SSH_PORT` — normally `22`;
- `REG_SSH_USER` — the hosting SSH account;
- `REG_DEPLOY_ROOT` — an absolute release directory outside the current web root;
- `REG_PUBLIC_URL` — `https://www.egoe-life.ru`.

Secrets:

- `REG_SSH_PRIVATE_KEY` — a dedicated deployment private key;
- `REG_SSH_KNOWN_HOSTS` — a separately verified host-key line.

Database passwords, Telegram tokens, and application secrets do not belong in GitHub Actions.

## Server layout

The deployment root must contain:

```text
incoming/
releases/
  <sha>/api/leads/         # immutable, reviewed PHP application code when backend is enabled
shared/
  leads/                   # persistent config/runtime; never copied into a release
state/site-hostname       # exactly: egoe-life.ru
state/production-enabled  # exactly: egoe-life.ru; create only after bootstrap review
state/collection-approved # optional collection approval; exact content: egoe-life.ru
state/relay-approved      # optional relay approval; exact content: egoe-life.ru, mode 0600
state/email-delivery-approved # optional corporate email approval; exact content: egoe-life.ru, mode 0600
state/bootstrap-plan      # approved SHA and NO_SAFE_PREVIOUS; rotates only after a verified failed-smoke rollback
legacy/
  physical-docroot-pre-rkn-20260823/  # preserved old physical site; never an automatic release
current -> releases/<active release>
```

Before enabling deployment, create a compliance-safe baseline directory under `releases/` and point `current` to it. Do not use the old production copy as a rollback target when it still contains legacy forms, Google Apps Script, or stale legal text: a failed first deploy would reactivate them. `ops/deploy/safe-baseline/` is the fail-closed recovery page for the initial cutover; it has no forms, external scripts, maps, or storage. After the first successful release, rollback targets only previously verified immutable release SHAs.

Production must then serve `<REG_DEPLOY_ROOT>/current`. The one-time `.github/workflows/bootstrap-production.yml` workflow performs the reviewed symlink cutover for the confirmed REG.RU layout: it atomically preserves the physical `/var/www/u3602289/data/www/egoe-life.ru` directory below `legacy/`, installs the hash-verified safe baseline, and points the live path to `egoe-deploy/current`. A production deploy refuses to start without the baseline `current` symlink, so automatic rollback always has a real, safe target.

The old physical tree is a recoverable emergency copy, not a release target: it can still contain legacy forms, Google Apps Script or stale legal text. It is never selected by `remote-release.sh` and must not be deleted until a separate restore review has succeeded.

An existing pre-bootstrap `current -> releases/baseline-20260823` is also treated as unreviewed legacy content. Bootstrap replaces it with the new hash-verified `safe-baseline-<SHA>` before touching the live document root and records `NO_SAFE_PREVIOUS`; neither an internal trap nor an external-smoke rollback can reactivate that legacy release. A failed external smoke restores the physical live directory but deliberately keeps `current` on the new safe baseline for an unambiguous retry. `production-enabled` remains absent, so the normal deploy workflow stays closed.

The `current` symlink is authoritative. A pre-existing informational `state/current` value may still name the legacy baseline until the first normal release activation, when `remote-release.sh` replaces it atomically; bootstrap, verification and rollback never use that stale value as a target.

Keep the deployment root outside the existing `/www/egoe-life.ru` directory until the real absolute SSH path and symlink behavior have been checked.

`state/` belongs only to the release mechanism. `shared/leads/` is the non-public location for lead API configuration, runtime state, and secrets. Neither directory is below `current`, neither is included in a GitHub artifact, and the deploy script never copies or deletes their contents. Give `shared/leads/` the narrowest hosting-user permissions that the PHP handler supports.

A reviewed release contains PHP application files below `api/leads/`; they remain immutable files in `dist/`, are covered by the same per-file SHA-256 manifest, and receive `php -l` plus a real SQLite health check before activation. Persistent files such as `.env`, `api/config.php`, `api/config/`, `api/state/`, `api/storage/`, and `api/runtime/` are rejected by the artifact verifier. The application resolves its generated `0600` configuration, SQLite, backups and runtime state from `<REG_DEPLOY_ROOT>/shared/leads/` outside the document root.

The server must provide `tar`, `sha256sum`, CLI PHP 8.2 or newer with `pdo_sqlite`, `sqlite3` online-backup support, `mbstring` and `curl`, plus `find` and `flock`. Corporate email delivery additionally requires `proc_open`, `proc_get_status`, `proc_terminate`, `proc_close` and an executable local `/usr/sbin/sendmail`. `flock` serializes deploy and rollback operations on the host in addition to the GitHub Actions concurrency group. The RKN release refuses activation when backend health fails, when collection is enabled without `collection-approved`, when a relay is enabled without `relay-approved`, or when effective email delivery lacks `email-delivery-approved`.

The deployment root, `state/`, state markers and optional approval markers must be owned by the deployment account and must not be group- or world-writable. `relay-approved`, `telegram-history-approved`, `telegram-delivery-approved` and `email-delivery-approved` are stricter: each must be an owned regular non-symlink file with exact mode `0600` and exact contents `egoe-life.ru` without a trailing newline. Bootstrap creates its state and production marker with mode `0600`; the preserved legacy parent uses mode `0700`. A path of the wrong type, a symlink marker or an ownership/mode mismatch fails closed.

Relay approval and collection approval are independent. A valid `relay-approved` marker never enables collection, and relay health may remain disabled with or without the marker. When health reports `relayEnabled=true`, however, both preflight and activation require the valid relay marker. Deploy or remove that marker only as a separate reviewed server operation; the release workflow never creates it.

Corporate email approval is independent from collection, relay and Telegram. Persistent `shared/leads/config.php` must keep the fixed recipient and sender `zakaz@egoe-life.ru`, sender name `EGOE — сайт`, and email disabled until the code release is active. Use the protected `Manage REG.RU lead email delivery` workflow against the exact live `main` SHA: `preflight` inspects state, `enable` requires `ENABLE_EMAIL`, and `disable` requires `DISABLE_EMAIL`. Its release-bound server helper serializes against deployments, atomically preserves unrelated private configuration, applies the marker/config change in fail-closed order, and checks CLI health plus public release provenance. Release deployment never creates or deletes the marker, the control action never creates a lead, and no mail credentials are stored in GitHub.

## One-time bootstrap

Run this only once, after the collection-gate commit is merged to `main` and its GitHub Pages run is successful:

1. Open `One-time bootstrap of REG.RU production` and provide that Pages run ID, the exact 40-character main SHA and `BOOTSTRAP`.
2. Approve the `production` environment deployment.
3. The workflow rechecks the Pages provenance, exact target variables, pinned SSH host key and both safe-baseline hashes.
4. The server `stage` and `prepare` subcommands require `collection-approved` and `production-enabled` to be absent. They replace any unreviewed legacy `current` with the form-free baseline before preserving the old physical tree and switching the live path. Internal failures restore the physical document root while retaining only the new verified safe `current` target.
5. Before enablement, the workflow downloads the public baseline over canonical HTTPS and checks its exact body hash, security/no-cache/noindex headers and absence of cookies. It also rechecks the server state.
6. Only after that external smoke succeeds does the separate server `enable` subcommand atomically create `state/production-enabled`. It never creates `state/collection-approved`.
7. If the external smoke fails, the workflow runs the bootstrap `rollback` subcommand. The production marker remains absent and the original physical document root is restored without deleting either tree.

If the runner is interrupted after `prepare`, the fail-closed baseline may remain live while the physical tree stays recoverable under `legacy/`; rerun the same reviewed bootstrap rather than moving paths manually. If REG.RU rejects SSH before a banner, no bootstrap mutation occurs. Do not create `collection-approved` as a workaround: online collection remains OFF until the separate legal and server approval process is complete.

If a failed external smoke requires a fix and therefore a new `main` SHA, bootstrap can replace the old `bootstrap-plan` only from the exact rolled-back state: both enablement markers are absent, the public path is again the owned physical directory, the legacy backup path is absent, and `current` still names the old `safe-baseline-<SHA>`. The old baseline is rescanned as an exact two-file, owner/mode-hardened, form/script/external-runtime-free tree with the required fail-closed headers before the plan is atomically moved to the new reviewed SHA. Any drift blocks the retry and leaves the physical site and old plan untouched.

## Release flow

1. Push reviewed source to GitHub `main`.
2. Wait for the GitHub Pages workflow and inspect staging.
3. Copy its workflow run ID and exact commit SHA.
4. On the first release only, complete the one-time bootstrap above. A successful bootstrap enables the normal workflow but leaves the form-free safe baseline live.
5. Run `Deploy approved staging release to REG.RU` in `preflight` mode with the same Pages run and SHA.
6. After production approval, rerun it with `mode=deploy` and `confirmation=DEPLOY`.
7. The server extracts into a new release and atomically replaces `current`.
8. An existing directory for the same SHA is never trusted from its manifest alone: every listed file, size, SHA-256, aggregate hash, extra path, symlink, and PHP syntax is checked again before activation.
9. The post-activation smoke reruns the server preflight, including collection, relay, Telegram and email approval gates, before checking a real product page, the exact API route, collection status and a cache-busted `release.json`. Any failure invokes rollback to the recorded previous immutable release.

Only `dist/` is published. The workflow never rebuilds after staging and never deploys a working tree or repository root.

Preflight uploads or activates no release. It does execute the current backend `health` command so that the effective collection/relay flags are checked against their independent approval markers; that command may perform its built-in idempotent SQLite/permission normalization.
