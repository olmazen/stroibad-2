# Telegram callbacks through long polling

This is the shared-hosting fallback for the `История клиента` and `Назад`
buttons when Telegram cannot reach the production webhook. It changes only the
callback transport. Lead delivery still uses the existing SQLite outbox and is
gated independently by `telegram-delivery-approved`.

## Safety contract

- `shared/telegram/config.php` remains mode `0600` inside an owned mode `0700`
  directory. Tokens are never command arguments, output or logs.
- `shared/telegram/poll-offset` and `poll.lock` are owned regular files with
  mode `0600`; symlinks and unsafe permissions fail closed.
- `flock` allows only one worker. Each update offset is stored atomically only
  after a successful callback edit/answer. A transport failure is retried on
  the next run; repeated edits accept only Telegram's exact “not modified”
  response.
- Malformed, forged and unauthorized callbacks are consumed without exposing
  lead data and cannot block later updates.
- The worker asks only for `callback_query`, performs no long HTTP wait and has
  a 40-second processing budget. Overlapping cron runs exit successfully as
  `busy:true`.

## Activation order

Keep direct lead delivery off until both History and Back have passed a real
group test.

```sh
DEPLOY_ROOT=/var/www/u3602289/data/www/egoe-deploy

EGOE_DEPLOY_ROOT="$DEPLOY_ROOT" /usr/bin/php \
  "$DEPLOY_ROOT/current/api/telegram/cli/telegram.php" webhook-info

EGOE_DEPLOY_ROOT="$DEPLOY_ROOT" /usr/bin/php \
  "$DEPLOY_ROOT/current/api/telegram/cli/telegram.php" delete-webhook

EGOE_DEPLOY_ROOT="$DEPLOY_ROOT" /usr/bin/php \
  "$DEPLOY_ROOT/current/api/telegram/cli/telegram.php" poll 10
```

`delete-webhook` always sends `drop_pending_updates:false` and verifies that
the webhook URL is empty. Therefore the callback already pending at Telegram
is preserved for the first poll. Do not register a webhook while cron polling
is active: Telegram permits only one of these delivery modes.

The one-minute shared-hosting cron entry is:

```cron
* * * * * EGOE_DEPLOY_ROOT='/var/www/u3602289/data/www/egoe-deploy' /usr/bin/php '/var/www/u3602289/data/www/egoe-deploy/current/api/telegram/cli/telegram.php' poll 10 >/dev/null 2>&1
```

Install exactly one matching entry. Run one manual poll first and confirm that
its JSON has `busy:false`, then click `История клиента` and `Назад` in the real
group. The message must be edited in place both times. A following manual poll
must report no new processed callback. Only after that proof may the separate
delivery config/marker be enabled.

## Rollback

Disable direct lead delivery first. Remove the polling cron entry, wait for any
running worker to finish, then register the webhook only after its inbound path
is independently reachable:

```sh
DEPLOY_ROOT=/var/www/u3602289/data/www/egoe-deploy
EGOE_DEPLOY_ROOT="$DEPLOY_ROOT" /usr/bin/php \
  "$DEPLOY_ROOT/current/api/telegram/cli/telegram.php" register-webhook
```

Do not delete `poll-offset`: keeping it prevents an already processed callback
from being replayed if polling is selected again.
