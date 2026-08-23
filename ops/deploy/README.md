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
state/site-hostname       # exactly: egoe-life.ru
state/production-enabled  # exactly: egoe-life.ru; create only after bootstrap review
current -> releases/<active release>
```

Before enabling deployment, copy the current public site into a baseline directory under `releases/`, point `current` to that baseline, and change the ISPmanager document root to `<REG_DEPLOY_ROOT>/current`. The document-root switch is a separate production change and must not be performed during a connectivity test.

Keep the deployment root outside the existing `/www/egoe-life.ru` directory until the real absolute SSH path and symlink behavior have been checked.

## Release flow

1. Push reviewed source to GitHub `main`.
2. Wait for the GitHub Pages workflow and inspect staging.
3. Copy its workflow run ID and exact commit SHA.
4. Run `Deploy approved staging release to REG.RU` in `preflight` mode.
5. After production approval, rerun it with `mode=deploy` and `confirmation=DEPLOY`.
6. The server extracts into a new release and atomically replaces `current`.
7. Failed HTTP smoke checks invoke rollback to the recorded previous release.

Only `dist/` is published. The workflow never rebuilds after staging and never deploys a working tree or repository root.
