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
current -> releases/<active release>
```

Before enabling deployment, create a compliance-safe baseline directory under `releases/` and point `current` to it. Do not use the old production copy as a rollback target when it still contains legacy forms, Google Apps Script, or stale legal text: a failed first deploy would reactivate them. `ops/deploy/safe-baseline/` is the fail-closed recovery page for the initial cutover; it has no forms, external scripts, maps, or storage. After the first successful release, rollback targets only previously verified immutable release SHAs.

Production must then serve `<REG_DEPLOY_ROOT>/current`: either change the ISPmanager document root to that path or, after a separately reviewed backup, replace the old physical `/www/egoe-life.ru` directory with a symlink to it. The workflow does neither bootstrap operation. A production deploy refuses to start without the baseline `current` symlink, so automatic rollback always has a real, safe target.

Keep the deployment root outside the existing `/www/egoe-life.ru` directory until the real absolute SSH path and symlink behavior have been checked.

`state/` belongs only to the release mechanism. `shared/leads/` is the non-public location for lead API configuration, runtime state, and secrets. Neither directory is below `current`, neither is included in a GitHub artifact, and the deploy script never copies or deletes their contents. Give `shared/leads/` the narrowest hosting-user permissions that the PHP handler supports.

A reviewed release contains PHP application files below `api/leads/`; they remain immutable files in `dist/`, are covered by the same per-file SHA-256 manifest, and receive `php -l` plus a real SQLite health check before activation. Persistent files such as `.env`, `api/config.php`, `api/config/`, `api/state/`, `api/storage/`, and `api/runtime/` are rejected by the artifact verifier. The application resolves its generated `0600` configuration, SQLite, backups and runtime state from `<REG_DEPLOY_ROOT>/shared/leads/` outside the document root.

The server must provide `tar`, `sha256sum`, CLI PHP 8.2 or newer with `pdo_sqlite`, `mbstring` and `curl`, plus `find` and `flock`. `flock` serializes deploy and rollback operations on the host in addition to the GitHub Actions concurrency group. The RKN release refuses activation when backend health fails or any external relay is enabled.

## Release flow

1. Push reviewed source to GitHub `main`.
2. Wait for the GitHub Pages workflow and inspect staging.
3. Copy its workflow run ID and exact commit SHA.
4. Run `Deploy approved staging release to REG.RU` in `preflight` mode.
5. After production approval, rerun it with `mode=deploy` and `confirmation=DEPLOY`.
6. The server extracts into a new release and atomically replaces `current`.
7. An existing directory for the same SHA is never trusted from its manifest alone: every listed file, size, SHA-256, aggregate hash, extra path, symlink, and PHP syntax is checked again before activation.
8. Failed HTTP smoke checks, including a real product page, the exact API route and a cache-busted `release.json`, invoke rollback to the recorded previous release.

Only `dist/` is published. The workflow never rebuilds after staging and never deploys a working tree or repository root.
