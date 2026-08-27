#!/bin/sh

set -eu
umask 077

PHP_BIN=${EGOE_ANALYTICS_PHP_BIN:-/usr/bin/php}
CLI_PATH=${EGOE_ANALYTICS_CLI:-/var/www/u3602289/data/www/egoe-deploy/current/api/leads/cli/daily-report.php}
CONFIG_PATH=${EGOE_ANALYTICS_CONFIG:-/var/www/u3602289/data/www/egoe-deploy/shared/analytics/config.php}
OUTBOX_DIR=${EGOE_ANALYTICS_OUTBOX:-/var/www/u3602289/data/www/egoe-deploy/shared/analytics/outbox}

case "$PHP_BIN:$CLI_PATH:$CONFIG_PATH:$OUTBOX_DIR" in
  /*:/*:/*:/*) ;;
  *)
    echo "ERROR: Analytics runtime paths must be absolute" >&2
    exit 1
    ;;
esac
if [ ! -x "$PHP_BIN" ]; then
  echo "ERROR: PHP CLI is unavailable" >&2
  exit 1
fi
if [ -L "$OUTBOX_DIR" ]; then
  echo "ERROR: Analytics outbox must not be a symlink" >&2
  exit 1
fi
mkdir -p "$OUTBOX_DIR"
chmod 0700 "$OUTBOX_DIR"

temporary=$(mktemp "$OUTBOX_DIR/.daily-report.XXXXXX")
cleanup() {
  rm -f "$temporary"
}
trap cleanup EXIT HUP INT TERM

if [ "${EGOE_ANALYTICS_SEND:-0}" = "1" ]; then
  set -- --send
else
  set --
fi
"$PHP_BIN" "$CLI_PATH" --config "$CONFIG_PATH" "$@" >"$temporary"
report_date=$("$PHP_BIN" -r '
  $payload=json_decode(file_get_contents($argv[1]), true, 32, JSON_THROW_ON_ERROR);
  $date=$payload["report_date"] ?? "";
  if (($payload["schema"] ?? "") !== "egoe.daily-analytics.v1"
      || !is_string($date)
      || preg_match("/^\\d{4}-\\d{2}-\\d{2}$/D", $date) !== 1) {
      fwrite(STDERR, "ERROR: Daily report contract validation failed\n");
      exit(1);
  }
  echo $date;
' "$temporary")

target="$OUTBOX_DIR/daily-report-$report_date.json"
if [ -L "$target" ]; then
  echo "ERROR: Daily report target must not be a symlink" >&2
  exit 1
fi
chmod 0600 "$temporary"
mv -f "$temporary" "$target"
trap - EXIT HUP INT TERM
printf '%s\n' "$target"
