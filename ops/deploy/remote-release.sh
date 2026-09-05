#!/bin/sh

set -eu

egoe_php_command=${EGOE_PHP_BIN:-php}

die() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command is unavailable: $1"
}

validate_root() {
  case "$1" in
    /*) ;;
    *) die "Deploy root must be an absolute path" ;;
  esac
  case "$1" in
    /|/bin|/boot|/dev|/etc|/home|/root|/tmp|/usr|/var|/var/www|/www)
      die "Deploy root is too broad: $1"
      ;;
    *//*|*/../*|*/./*|*/..|*/.|*/)
      die "Deploy root must be normalized"
      ;;
    *[!A-Za-z0-9_./-]*)
      die "Deploy root contains unsafe characters"
      ;;
  esac
  [ -d "$1" ] || die "Deploy root does not exist: $1"
  [ ! -L "$1" ] || die "Deploy root must not be a symlink"
  [ -f "$1/state/site-hostname" ] || die "Missing site-hostname marker"
  [ ! -L "$1/state/site-hostname" ] || die "site-hostname marker must not be a symlink"
  [ "$(cat "$1/state/site-hostname")" = "egoe-life.ru" ] || die "Unexpected site marker"
}

validate_sha() {
  printf '%s' "$1" | grep -Eq '^[0-9a-f]{40}$' || die "Invalid commit SHA"
}

validate_sha256() {
  printf '%s' "$1" | grep -Eq '^[0-9a-f]{64}$' || die "Invalid SHA-256"
}

validate_release_target() {
  release_target=$1
  case "$release_target" in
    releases/*) release_name=${release_target#releases/} ;;
    *) die "Release link points outside releases" ;;
  esac
  case "$release_name" in
    ''|.|..|*/*|*[!A-Za-z0-9._-]*) die "Unsafe release link target" ;;
  esac
}

validate_owned_mode() {
  secured_path=$1
  expected_type=$2
  label=$3
  current_uid=$(id -u)
  "$egoe_php_command" -r '
    $stat = lstat($argv[1]);
    $expectedUid = (int) $argv[2];
    $expectedType = $argv[3];
    if (!is_array($stat) || $stat["uid"] !== $expectedUid || ($stat["mode"] & 0022) !== 0) exit(2);
    $type = $stat["mode"] & 0170000;
    if ($expectedType === "directory" && $type !== 0040000) exit(3);
    if ($expectedType === "file" && $type !== 0100000) exit(4);
  ' "$secured_path" "$current_uid" "$expected_type" \
    || die "$label must be owned by the deployment user and not group/world-writable"
}

validate_optional_site_marker() {
  marker_path=$1
  marker_label=$2
  exact_mode=${3:-}
  if [ ! -e "$marker_path" ] && [ ! -L "$marker_path" ]; then
    return 1
  fi
  [ ! -L "$marker_path" ] || die "$marker_label must not be a symlink"
  [ -f "$marker_path" ] || die "$marker_label must be a regular file"
  validate_owned_mode "$marker_path" file "$marker_label"
  if [ -n "$exact_mode" ]; then
    "$egoe_php_command" -r '
      $stat = lstat($argv[1]);
      $expected = octdec($argv[2]);
      exit(is_array($stat) && (($stat["mode"] & 0777) === $expected) ? 0 : 1);
    ' "$marker_path" "$exact_mode" || die "$marker_label permissions must be exactly 0$exact_mode"
  fi
  "$egoe_php_command" -r '
    $value = file_get_contents($argv[1]);
    exit($value === "egoe-life.ru" ? 0 : 1);
  ' "$marker_path" || die "Invalid $marker_label"
  return 0
}

validate_state_approval_markers() {
  deploy_root=$1
  collection_marker="$deploy_root/state/collection-approved"
  relay_marker="$deploy_root/state/relay-approved"
  telegram_history_marker="$deploy_root/state/telegram-history-approved"
  telegram_delivery_marker="$deploy_root/state/telegram-delivery-approved"
  email_delivery_marker="$deploy_root/state/email-delivery-approved"
  collection_marker_approved=false
  relay_marker_approved=false
  telegram_history_marker_approved=false
  telegram_delivery_marker_approved=false
  email_delivery_marker_approved=false
  if validate_optional_site_marker "$collection_marker" "Collection approval marker"; then
    collection_marker_approved=true
  fi
  if validate_optional_site_marker "$relay_marker" "Relay approval marker" 600; then
    relay_marker_approved=true
  fi
  if validate_optional_site_marker "$telegram_history_marker" "Telegram history approval marker" 600; then
    telegram_history_marker_approved=true
  fi
  if validate_optional_site_marker "$telegram_delivery_marker" "Telegram delivery approval marker" 600; then
    telegram_delivery_marker_approved=true
  fi
  if validate_optional_site_marker "$email_delivery_marker" "Email delivery approval marker" 600; then
    email_delivery_marker_approved=true
  fi
}

validate_lead_health_contract() {
  lead_health=$1
  collection_approved=$2
  relay_approved=$3
  telegram_history_approved=$4
  telegram_delivery_approved=$5
  email_delivery_approved=$6
  printf '%s' "$lead_health" | "$egoe_php_command" -r '
    $health = json_decode(stream_get_contents(STDIN), true);
    $collectionApproved = ($argv[1] ?? "false") === "true";
    $relayApproved = ($argv[2] ?? "false") === "true";
    $telegramHistoryApproved = ($argv[3] ?? "false") === "true";
    $telegramDeliveryApproved = ($argv[4] ?? "false") === "true";
    $emailDeliveryApproved = ($argv[5] ?? "false") === "true";
    $collectionEnabled = $health["collectionEnabled"] ?? null;
    $relayEnabled = $health["relayEnabled"] ?? null;
    $telegramHistoryEnabled = $health["telegramHistoryEnabled"] ?? false;
    $telegramDeliveryEnabled = $health["telegramDeliveryEnabled"] ?? false;
    $emailDeliveryEnabled = $health["emailDeliveryEnabled"] ?? false;
    exit(is_array($health)
      && ($health["ok"] ?? false) === true
      && ($health["schemaVersion"] ?? null) === 2
      && is_bool($collectionEnabled)
      && ($collectionApproved || $collectionEnabled === false)
      && is_bool($relayEnabled)
      && ($relayEnabled === false || $relayApproved)
      && is_bool($telegramHistoryEnabled)
      && ($telegramHistoryEnabled === false || $telegramHistoryApproved)
      && is_bool($telegramDeliveryEnabled)
      && ($telegramDeliveryEnabled === false || ($telegramDeliveryApproved && $telegramHistoryApproved && $telegramHistoryEnabled && $relayEnabled === false))
      && is_bool($emailDeliveryEnabled)
      && ($emailDeliveryEnabled === false || $emailDeliveryApproved) ? 0 : 1);
  ' "$collection_approved" "$relay_approved" "$telegram_history_approved" "$telegram_delivery_approved" "$email_delivery_approved" \
    || die "Lead backend health contract failed: collection, relay, Telegram, or email approval mismatch"
}

validate_current_lead_health_contract() {
  deploy_root=$1
  current_lead_cli="$deploy_root/current/api/leads/cli/leads.php"
  if [ -e "$current_lead_cli" ] || [ -L "$current_lead_cli" ]; then
    [ ! -L "$current_lead_cli" ] || die "Current lead backend CLI must not be a symlink"
    [ -f "$current_lead_cli" ] || die "Current lead backend CLI must be a regular file"
    current_lead_health=$(EGOE_DEPLOY_ROOT="$deploy_root" "$egoe_php_command" "$current_lead_cli" health) \
      || die "Current lead backend health check failed"
    validate_state_approval_markers "$deploy_root"
    validate_lead_health_contract \
      "$current_lead_health" \
      "$collection_marker_approved" \
      "$relay_marker_approved" \
      "$telegram_history_marker_approved" \
      "$telegram_delivery_marker_approved" \
      "$email_delivery_marker_approved"
  else
    [ "$relay_marker_approved" = "false" ] \
      && [ "$telegram_history_marker_approved" = "false" ] \
      && [ "$telegram_delivery_marker_approved" = "false" ] \
      && [ "$email_delivery_marker_approved" = "false" ] \
      || die "External delivery approval marker requires a deployed lead backend"
  fi
}

verify_release_tree() {
  release_root=$1
  expected_sha=$2
  "$egoe_php_command" -r '
    $root = $argv[1];
    $expectedSha = $argv[2];
    if (!is_dir($root) || is_link($root)) exit(2);
    $manifestPath = $root . DIRECTORY_SEPARATOR . "release.json";
    if (!is_file($manifestPath) || is_link($manifestPath)) exit(3);
    $manifest = json_decode(file_get_contents($manifestPath), true, 512, JSON_THROW_ON_ERROR);
    if (($manifest["schemaVersion"] ?? null) !== 1) exit(2);
    if (($manifest["source"]["commit"] ?? null) !== $expectedSha) exit(3);
    if (($manifest["source"]["dirty"] ?? null) !== false) exit(4);
    if (!is_array($manifest["files"] ?? null)) exit(5);

    $listed = [];
    $listedPaths = [];
    $totalBytes = 0;
    $artifactInput = "";
    foreach ($manifest["files"] as $entry) {
      $path = $entry["path"] ?? null;
      if (!is_string($path) || $path === "" || strpos($path, "\\") !== false || substr($path, 0, 1) === "/") exit(6);
      if (preg_match("/[\\x00-\\x1f\\x7f]/", $path)) exit(7);
      $parts = explode("/", $path);
      if (in_array("", $parts, true) || in_array(".", $parts, true) || in_array("..", $parts, true)) exit(8);
      $lowerParts = array_map("strtolower", $parts);
      $rootPart = $lowerParts[0];
      $basename = $lowerParts[count($lowerParts) - 1];
      $normalizedLower = implode("/", $lowerParts);
      $allowedPhp = [
        "api/leads/index.php",
        "api/leads/lib/leadbackend.php",
        "api/leads/lib/emaildelivery.php",
        "api/leads/lib/dailyanalytics.php",
        "api/leads/cli/leads.php",
        "api/leads/cli/daily-report.php",
        "api/telegram/index.php",
        "api/telegram/lib/telegramhistory.php",
        "api/telegram/cli/telegram.php",
      ];
      if (str_ends_with($basename, ".php") && !in_array($normalizedLower, $allowedPhp, true)) exit(24);
      if ($basename === ".env" || strpos($basename, ".env.") === 0) exit(20);
      if (in_array($rootPart, [".git", ".github", ".private", "shared", "state", "storage", "runtime"], true)) exit(21);
      if ($rootPart === "api") {
        $apiDirectories = array_slice($lowerParts, 1, -1);
        if (array_intersect($apiDirectories, ["config", "state", "storage", "runtime"])) exit(22);
        if (preg_match("/^config(?:[._-].*)?\\.php$/", $basename) || $basename === "secrets.php") exit(23);
      }
      if (isset($listed[$path])) exit(9);
      $absolute = $root . DIRECTORY_SEPARATOR . str_replace("/", DIRECTORY_SEPARATOR, $path);
      if (!is_file($absolute) || is_link($absolute)) exit(10);
      $bytes = filesize($absolute);
      $hash = hash_file("sha256", $absolute);
      if (!is_int($entry["bytes"] ?? null) || $bytes !== $entry["bytes"]) exit(11);
      if (!is_string($entry["sha256"] ?? null) || !hash_equals($entry["sha256"], $hash)) exit(12);
      $listed[$path] = true;
      $listedPaths[] = $path;
      $totalBytes += $bytes;
      $artifactInput .= $path . "\0" . $hash . "\0" . $bytes . "\n";
    }
    $sortedListedPaths = $listedPaths;
    sort($sortedListedPaths, SORT_STRING);

    // The build manifest follows a deterministic depth-first directory walk.
    // A flat PHP string sort is different when a directory name also prefixes
    // a sibling file (for example, "maf/..." and "maf-collection.webp").
    // Membership is checked below using sorted copies; the signed aggregate is
    // still recomputed in the original canonical manifest build order.

    $actualPaths = [];
    $iterator = new RecursiveIteratorIterator(
      new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
      RecursiveIteratorIterator::LEAVES_ONLY
    );
    foreach ($iterator as $item) {
      if ($item->isLink()) exit(14);
      if (!$item->isFile()) exit(15);
      $absolute = $item->getPathname();
      $relative = str_replace(DIRECTORY_SEPARATOR, "/", substr($absolute, strlen($root) + 1));
      if ($relative !== "release.json") $actualPaths[] = $relative;
    }
    sort($actualPaths, SORT_STRING);
    if ($actualPaths !== $sortedListedPaths) exit(16);
    if (($manifest["artifact"]["fileCount"] ?? null) !== count($actualPaths)) exit(17);
    if (($manifest["artifact"]["totalBytes"] ?? null) !== $totalBytes) exit(18);
    $aggregate = hash("sha256", $artifactInput);
    if (!is_string($manifest["artifact"]["sha256"] ?? null) || !hash_equals($manifest["artifact"]["sha256"], $aggregate)) exit(19);
  ' "$release_root" "$expected_sha" || die "Complete release-tree verification failed"
}

lint_php_tree() {
  release_root=$1
  find "$release_root" -type f -name '*.php' -print | while IFS= read -r php_file; do
    "$egoe_php_command" -l "$php_file" >/dev/null || die "PHP syntax check failed: $php_file"
  done
}

acquire_lock() {
  deploy_root=$1
  [ ! -L "$deploy_root/state/deploy.lock" ] || die "Deployment lock must not be a symlink"
  exec 9>"$deploy_root/state/deploy.lock"
  chmod 600 "$deploy_root/state/deploy.lock"
  validate_owned_mode "$deploy_root/state/deploy.lock" file "Deployment lock"
  flock -n 9 || die "Another server-side deployment operation is active"
}

write_state() {
  state_file=$1
  state_value=$2
  [ ! -L "$state_file" ] || die "State file must not be a symlink"
  temporary_state="$state_file.tmp.$$"
  [ ! -e "$temporary_state" ] && [ ! -L "$temporary_state" ] || die "Temporary state path already exists"
  (umask 077; printf '%s\n' "$state_value" > "$temporary_state")
  chmod 600 "$temporary_state"
  mv "$temporary_state" "$state_file"
  validate_owned_mode "$state_file" file "Deployment state file"
}

replace_symlink() {
  source_link=$1
  target_path=$2
  "$egoe_php_command" -r '
    if (!is_link($argv[1])) exit(2);
    if (!rename($argv[1], $argv[2])) exit(3);
  ' "$source_link" "$target_path" || die "Atomic symlink switch failed"
}

restore_failed_deploy_switch() {
  exit_code=$?
  trap - EXIT HUP INT TERM
  set +e

  if [ "${deployment_current_switched:-0}" = "1" ] && [ "${deployment_switch_complete:-0}" != "1" ]; then
    expected_target="releases/$expected_sha"
    if [ -L "$deploy_root/current" ] && [ "$(readlink "$deploy_root/current" 2>/dev/null)" = "$expected_target" ]; then
      restore_link="$deploy_root/current.deploy-restore.$$"
      if [ ! -e "$restore_link" ] && [ ! -L "$restore_link" ] \
        && ln -s "$previous_target" "$restore_link" \
        && "$egoe_php_command" -r '
          exit(is_link($argv[1]) && rename($argv[1], $argv[2]) ? 0 : 1);
        ' "$restore_link" "$deploy_root/current"; then
        previous_name=${previous_target#releases/}
        restore_state="$deploy_root/state/current.restore.$$"
        (umask 077; printf '%s\n' "$previous_name" > "$restore_state")
        chmod 600 "$restore_state" 2>/dev/null || true
        mv "$restore_state" "$deploy_root/state/current" 2>/dev/null || true
        printf '%s\n' "ERROR: activation failed; previous current symlink restored" >&2
      else
        printf '%s\n' "ERROR: activation failed and previous current symlink could not be restored" >&2
      fi
    else
      printf '%s\n' "ERROR: activation failed after current changed unexpectedly; automatic restore refused" >&2
    fi
  fi

  if [ -n "${next_link:-}" ] && [ -L "$next_link" ]; then
    unlink "$next_link" 2>/dev/null || true
  fi
  exit "$exit_code"
}

preflight() {
  deploy_root=$1
  check_current_health=${2:-true}
  validate_root "$deploy_root"
  for command_name in tar sha256sum "$egoe_php_command" chmod id ln mv readlink grep find sort flock cmp unlink; do
    require_command "$command_name"
  done
  "$egoe_php_command" -r '
    exit(PHP_VERSION_ID >= 80200
      && extension_loaded("pdo_sqlite")
      && extension_loaded("sqlite3")
      && method_exists("SQLite3", "backup")
      && extension_loaded("mbstring")
      && extension_loaded("curl") ? 0 : 1);
  ' || die "PHP CLI 8.2+ with pdo_sqlite, sqlite3 online backup, mbstring and curl is required"
  [ -w "$deploy_root" ] || die "Deploy root is not writable"
  validate_owned_mode "$deploy_root" directory "Deploy root"
  validate_owned_mode "$deploy_root/state/site-hostname" file "Site-hostname marker"
  for persistent_directory in incoming releases shared state; do
    [ -d "$deploy_root/$persistent_directory" ] || die "Missing persistent directory: $persistent_directory"
    [ ! -L "$deploy_root/$persistent_directory" ] || die "Persistent directory must not be a symlink: $persistent_directory"
  done
  validate_owned_mode "$deploy_root/state" directory "Deployment state directory"
  [ -d "$deploy_root/shared/leads" ] || die "Missing persistent lead runtime directory: shared/leads"
  [ ! -L "$deploy_root/shared/leads" ] || die "Persistent lead runtime directory must not be a symlink"
  [ -w "$deploy_root/shared/leads" ] || die "Persistent lead runtime directory is not writable"
  [ -f "$deploy_root/state/production-enabled" ] || die "Production deployment is not enabled"
  [ ! -L "$deploy_root/state/production-enabled" ] || die "Production marker must not be a symlink"
  validate_owned_mode "$deploy_root/state/production-enabled" file "Production marker"
  [ "$(cat "$deploy_root/state/production-enabled")" = "egoe-life.ru" ] || die "Invalid production marker"
  validate_state_approval_markers "$deploy_root"
  [ -L "$deploy_root/current" ] || die "Current baseline symlink is required before production deployment"
  current_target=$(readlink "$deploy_root/current")
  validate_release_target "$current_target"
  [ -d "$deploy_root/$current_target" ] || die "Current release directory is missing"
  [ ! -L "$deploy_root/$current_target" ] || die "Current release directory must not be a symlink"
  if [ "$check_current_health" = "true" ]; then
    validate_current_lead_health_contract "$deploy_root"
  fi
  df -h "$deploy_root"
  printf '%s\n' "PREFLIGHT_OK"
}

deploy() {
  deploy_root=$1
  expected_sha=$2
  archive=$3
  expected_archive_sha=$4

  preflight "$deploy_root" >/dev/null
  acquire_lock "$deploy_root"
  validate_state_approval_markers "$deploy_root"
  validate_sha "$expected_sha"
  validate_sha256 "$expected_archive_sha"

  case "$archive" in
    "$deploy_root"/incoming/*) ;;
    *) die "Archive is outside the incoming directory" ;;
  esac
  [ -f "$archive" ] || die "Release archive does not exist"
  actual_archive_sha=$(sha256sum "$archive" | awk '{print $1}')
  [ "$actual_archive_sha" = "$expected_archive_sha" ] || die "Release archive checksum mismatch"

  final_release="$deploy_root/releases/$expected_sha"
  temporary_release="$deploy_root/releases/.tmp-$expected_sha-$$"
  [ ! -e "$temporary_release" ] || die "Temporary release path already exists"
  mkdir "$temporary_release"
  trap 'rm -rf "$temporary_release"' EXIT HUP INT TERM
  tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$temporary_release"
  [ -f "$temporary_release/index.html" ] || die "Release has no index.html"
  [ -f "$temporary_release/release.json" ] || die "Release has no release.json"
  verify_release_tree "$temporary_release" "$expected_sha"
  lint_php_tree "$temporary_release"
  find "$temporary_release" -type d -exec chmod 755 {} \;
  find "$temporary_release" -type f -exec chmod 644 {} \;

  if [ ! -e "$final_release" ] && [ ! -L "$final_release" ]; then
    mv "$temporary_release" "$final_release"
    trap - EXIT HUP INT TERM
  else
    [ -d "$final_release" ] || die "Existing release path is not a directory"
    [ ! -L "$final_release" ] || die "Existing release path must not be a symlink"
    verify_release_tree "$final_release" "$expected_sha"
    lint_php_tree "$final_release"
    cmp "$temporary_release/release.json" "$final_release/release.json" >/dev/null \
      || die "Existing release does not match the reviewed transport artifact"
    rm -rf "$temporary_release"
    trap - EXIT HUP INT TERM
  fi

  lead_cli="$final_release/api/leads/cli/leads.php"
  [ -f "$lead_cli" ] || die "Release has no lead backend CLI"
  [ ! -L "$lead_cli" ] || die "Lead backend CLI must not be a symlink"
  EGOE_DEPLOY_ROOT="$deploy_root" "$egoe_php_command" "$lead_cli" init >/dev/null \
    || die "Lead backend initialization failed"
  lead_health=$(EGOE_DEPLOY_ROOT="$deploy_root" "$egoe_php_command" "$lead_cli" health) \
    || die "Lead backend health check failed"
  validate_state_approval_markers "$deploy_root"
  validate_lead_health_contract \
    "$lead_health" \
    "$collection_marker_approved" \
    "$relay_marker_approved" \
    "$telegram_history_marker_approved" \
    "$telegram_delivery_marker_approved" \
    "$email_delivery_marker_approved"

  [ -L "$deploy_root/current" ] || die "Current baseline symlink is required before production deployment"
  previous_target=$(readlink "$deploy_root/current")
  validate_release_target "$previous_target"
  [ -d "$deploy_root/$previous_target" ] || die "Current release directory is missing"
  [ ! -L "$deploy_root/$previous_target" ] || die "Current release directory must not be a symlink"
  write_state "$deploy_root/state/previous" "$previous_target"
  next_link="$deploy_root/current.next.$$"
  [ ! -e "$next_link" ] && [ ! -L "$next_link" ] || die "Temporary current link already exists"
  deployment_current_switched=0
  deployment_switch_complete=0
  trap restore_failed_deploy_switch EXIT HUP INT TERM
  ln -s "releases/$expected_sha" "$next_link"
  replace_symlink "$next_link" "$deploy_root/current"
  deployment_current_switched=1
  write_state "$deploy_root/state/current" "$expected_sha"
  printf '%s\n' "DEPLOYED_SHA=$expected_sha"
  deployment_switch_complete=1
  trap - EXIT HUP INT TERM
}

rollback() {
  deploy_root=$1
  preflight "$deploy_root" false >/dev/null
  acquire_lock "$deploy_root"
  [ -f "$deploy_root/state/previous" ] || die "No previous release is recorded"
  [ ! -L "$deploy_root/state/previous" ] || die "Previous marker must not be a symlink"
  previous_target=$(cat "$deploy_root/state/previous")
  validate_release_target "$previous_target"
  [ -d "$deploy_root/$previous_target" ] || die "Previous release directory is missing"
  [ ! -L "$deploy_root/$previous_target" ] || die "Previous release directory must not be a symlink"
  next_link="$deploy_root/current.rollback.$$"
  ln -s "$previous_target" "$next_link"
  replace_symlink "$next_link" "$deploy_root/current"
  previous_sha=${previous_target#releases/}
  write_state "$deploy_root/state/current" "$previous_sha"
  printf '%s\n' "ROLLED_BACK_SHA=$previous_sha"
}

action=${1:-}
case "$action" in
  preflight)
    [ "$#" -eq 2 ] || die "Usage: remote-release.sh preflight DEPLOY_ROOT"
    preflight "$2"
    ;;
  deploy)
    [ "$#" -eq 5 ] || die "Usage: remote-release.sh deploy DEPLOY_ROOT SHA ARCHIVE ARCHIVE_SHA256"
    deploy "$2" "$3" "$4" "$5"
    ;;
  rollback)
    [ "$#" -eq 2 ] || die "Usage: remote-release.sh rollback DEPLOY_ROOT"
    rollback "$2"
    ;;
  *) die "Unknown action: $action" ;;
esac
