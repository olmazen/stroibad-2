#!/bin/sh

set -eu

egoe_php_command=${EGOE_PHP_BIN:-php}
expected_hostname=egoe-life.ru

die() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command is unavailable: $1"
}

path_exists() {
  [ -e "$1" ] || [ -L "$1" ]
}

validate_sha() {
  printf '%s' "$1" | grep -Eq '^[0-9a-f]{40}$' || die "Invalid commit SHA"
}

validate_sha256() {
  printf '%s' "$1" | grep -Eq '^[0-9a-f]{64}$' || die "Invalid SHA-256"
}

validate_stage_token() {
  printf '%s' "$1" | grep -Eq '^[0-9]+-[0-9]+$' || die "Invalid staging token"
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

validate_exact_file() {
  file_path=$1
  expected_value=$2
  label=$3
  [ -f "$file_path" ] || die "$label is missing"
  [ ! -L "$file_path" ] || die "$label must not be a symlink"
  validate_owned_mode "$file_path" file "$label"
  [ "$(cat "$file_path")" = "$expected_value" ] || die "$label has an unexpected value"
}

require_absent() {
  ! path_exists "$1" || die "$2 must be absent"
}

validate_common() {
  deploy_root=$1
  case "$deploy_root" in
    /*/egoe-deploy) ;;
    *) die "Deploy root must be a normalized absolute egoe-deploy path" ;;
  esac
  case "$deploy_root" in
    *//*|*/../*|*/./*|*/..|*/.|*/)
      die "Deploy root must be normalized"
      ;;
    *[!A-Za-z0-9_./-]*)
      die "Deploy root contains unsafe characters"
      ;;
  esac

  for command_name in "$egoe_php_command" chmod cp flock grep id ln mkdir readlink rmdir unlink; do
    require_command "$command_name"
  done

  [ -d "$deploy_root" ] || die "Deploy root does not exist"
  [ ! -L "$deploy_root" ] || die "Deploy root must not be a symlink"
  [ -w "$deploy_root" ] || die "Deploy root is not writable"
  validate_owned_mode "$deploy_root" directory "Deploy root"
  for directory in incoming releases shared state; do
    [ -d "$deploy_root/$directory" ] || die "Missing deployment directory: $directory"
    [ ! -L "$deploy_root/$directory" ] || die "Deployment directory must not be a symlink: $directory"
  done
  validate_owned_mode "$deploy_root/state" directory "Deployment state directory"
  [ -d "$deploy_root/shared/leads" ] || die "Missing persistent lead runtime directory"
  [ ! -L "$deploy_root/shared/leads" ] || die "Persistent lead runtime directory must not be a symlink"
  [ -w "$deploy_root/shared/leads" ] || die "Persistent lead runtime directory is not writable"
  validate_exact_file "$deploy_root/state/site-hostname" "$expected_hostname" "site-hostname marker"

  collection_marker="$deploy_root/state/collection-approved"
  require_absent "$collection_marker" "Collection approval marker"

  site_parent=${deploy_root%/egoe-deploy}
  live_root="$site_parent/egoe-life.ru"
  legacy_root="$deploy_root/legacy"
  legacy_backup="$legacy_root/physical-docroot-pre-rkn-20260823"

  [ -d "$site_parent" ] || die "Site parent directory is missing"
  [ ! -L "$site_parent" ] || die "Site parent directory must not be a symlink"
  "$egoe_php_command" -r '
    $parent = stat($argv[1]);
    $root = stat($argv[2]);
    exit(is_array($parent) && is_array($root) && $parent["dev"] === $root["dev"] ? 0 : 1);
  ' "$site_parent" "$deploy_root" || die "Live and deployment roots must share one filesystem"
}

acquire_lock() {
  deploy_root=$1
  lock_file="$deploy_root/state/bootstrap.lock"
  [ ! -L "$lock_file" ] || die "Bootstrap lock must not be a symlink"
  exec 9>"$lock_file"
  chmod 600 "$lock_file"
  validate_owned_mode "$lock_file" file "Bootstrap lock"
  flock -n 9 || die "Another bootstrap or deployment operation is active"
}

file_sha256() {
  "$egoe_php_command" -r '
    if (!is_file($argv[1]) || is_link($argv[1])) exit(2);
    $hash = hash_file("sha256", $argv[1]);
    if (!is_string($hash)) exit(3);
    echo $hash;
  ' "$1"
}

verify_hash() {
  actual_hash=$(file_sha256 "$1") || die "Cannot hash $3"
  [ "$actual_hash" = "$2" ] || die "$3 checksum mismatch"
}

rename_absent() {
  source_path=$1
  target_path=$2
  "$egoe_php_command" -r '
    $source = $argv[1];
    $target = $argv[2];
    if ((!file_exists($source) && !is_link($source)) || file_exists($target) || is_link($target)) exit(2);
    if (!rename($source, $target)) exit(3);
  ' "$source_path" "$target_path" || die "Atomic rename to an absent target failed"
}

replace_with_symlink() {
  source_link=$1
  target_path=$2
  "$egoe_php_command" -r '
    $source = $argv[1];
    $target = $argv[2];
    if (!is_link($source)) exit(2);
    if (file_exists($target) && !is_link($target)) exit(3);
    if (!rename($source, $target)) exit(4);
  ' "$source_link" "$target_path" || die "Atomic symlink replacement failed"
}

write_once() {
  target_path=$1
  value=$2
  label=$3
  if path_exists "$target_path"; then
    validate_exact_file "$target_path" "$value" "$label"
    return
  fi
  temporary_path="$target_path.tmp.$$"
  require_absent "$temporary_path" "Temporary $label"
  umask 077
  printf '%s\n' "$value" > "$temporary_path"
  chmod 600 "$temporary_path"
  if ! ln "$temporary_path" "$target_path"; then
    unlink "$temporary_path" 2>/dev/null || true
    die "Cannot atomically create $label"
  fi
  unlink "$temporary_path"
  validate_exact_file "$target_path" "$value" "$label"
}

verify_baseline() {
  baseline_root=$1
  index_hash=$2
  htaccess_hash=$3
  validate_owned_mode "$baseline_root" directory "Safe baseline directory"
  validate_owned_mode "$baseline_root/index.html" file "Safe baseline index"
  validate_owned_mode "$baseline_root/.htaccess" file "Safe baseline htaccess"
  "$egoe_php_command" -r '
    $root = $argv[1];
    $expected = [".htaccess" => $argv[3], "index.html" => $argv[2]];
    if (!is_dir($root) || is_link($root)) exit(2);
    $seen = [];
    foreach (new FilesystemIterator($root, FilesystemIterator::SKIP_DOTS) as $item) {
      $name = $item->getFilename();
      if (!isset($expected[$name]) || !$item->isFile() || $item->isLink()) exit(3);
      $hash = hash_file("sha256", $item->getPathname());
      if (!is_string($hash) || !hash_equals($expected[$name], $hash)) exit(4);
      $seen[$name] = true;
    }
    ksort($seen, SORT_STRING);
    ksort($expected, SORT_STRING);
    exit(array_keys($seen) === array_keys($expected) ? 0 : 5);
  ' "$baseline_root" "$index_hash" "$htaccess_hash" || die "Safe baseline tree verification failed"
}

verify_fail_closed_baseline() {
  baseline_root=$1
  validate_owned_mode "$baseline_root" directory "Previous safe baseline directory"
  validate_owned_mode "$baseline_root/index.html" file "Previous safe baseline index"
  validate_owned_mode "$baseline_root/.htaccess" file "Previous safe baseline htaccess"
  "$egoe_php_command" -r '
    $root = $argv[1];
    if (!is_dir($root) || is_link($root)) exit(2);
    $expectedNames = [".htaccess", "index.html"];
    $actualNames = [];
    foreach (new FilesystemIterator($root, FilesystemIterator::SKIP_DOTS) as $item) {
      if (!$item->isFile() || $item->isLink()) exit(3);
      $actualNames[] = $item->getFilename();
    }
    sort($actualNames, SORT_STRING);
    if ($actualNames !== $expectedNames) exit(4);

    $html = file_get_contents($root . DIRECTORY_SEPARATOR . "index.html");
    $apache = file_get_contents($root . DIRECTORY_SEPARATOR . ".htaccess");
    if (!is_string($html) || !is_string($apache)) exit(5);
    if (preg_match("~<\\s*(?:form|script|iframe|input|textarea|select|button)\\b|https?://|localStorage|sessionStorage|document\\s*\\.\\s*cookie|fetch\\s*\\(|XMLHttpRequest~i", $html)) exit(6);
    if (stripos($html, "noindex,nofollow,noarchive") === false) exit(7);
    if (preg_match("~https?://|\\b(?:Rewrite|Redirect|Proxy|Set-Cookie|Refresh|Location|ErrorDocument)\\b~i", $apache)) exit(8);
    $required = [
      "Options -Indexes -MultiViews",
      "DirectoryIndex index.html",
      "Cache-Control \"no-store",
      "Content-Security-Policy \"default-src \x27none\x27",
      "form-action \x27none\x27",
      "X-Content-Type-Options \"nosniff\"",
      "X-Frame-Options \"DENY\"",
      "X-Robots-Tag \"noindex, nofollow, noarchive\"",
    ];
    foreach ($required as $needle) {
      if (strpos($apache, $needle) === false) exit(9);
    }
  ' "$baseline_root" || die "Previous current target is not a verified fail-closed baseline"
}

ensure_baseline() {
  deploy_root=$1
  expected_sha=$2
  index_hash=$3
  htaccess_hash=$4
  stage_token=$5
  final_release="$deploy_root/releases/safe-baseline-$expected_sha"
  stage_root="$deploy_root/incoming/bootstrap-$stage_token"

  [ -d "$stage_root" ] || die "Bootstrap staging directory is missing"
  [ ! -L "$stage_root" ] || die "Bootstrap staging directory must not be a symlink"
  [ -f "$stage_root/index.html" ] && [ ! -L "$stage_root/index.html" ] || die "Staged index.html is invalid"
  [ -f "$stage_root/htaccess" ] && [ ! -L "$stage_root/htaccess" ] || die "Staged htaccess is invalid"
  verify_hash "$stage_root/index.html" "$index_hash" "staged index.html"
  verify_hash "$stage_root/htaccess" "$htaccess_hash" "staged htaccess"

  if path_exists "$final_release"; then
    verify_baseline "$final_release" "$index_hash" "$htaccess_hash"
  else
    temporary_release="$deploy_root/releases/.safe-baseline-$expected_sha-$$"
    require_absent "$temporary_release" "Temporary safe baseline"
    mkdir "$temporary_release"
    chmod 755 "$temporary_release"
    cp "$stage_root/index.html" "$temporary_release/index.html"
    cp "$stage_root/htaccess" "$temporary_release/.htaccess"
    chmod 644 "$temporary_release/index.html" "$temporary_release/.htaccess"
    verify_baseline "$temporary_release" "$index_hash" "$htaccess_hash"
    rename_absent "$temporary_release" "$final_release"
    verify_baseline "$final_release" "$index_hash" "$htaccess_hash"
  fi

  unlink "$stage_root/index.html"
  unlink "$stage_root/htaccess"
  rmdir "$stage_root"
}

read_bootstrap_plan_value() {
  deploy_root=$1
  plan_file="$deploy_root/state/bootstrap-plan"
  [ -f "$plan_file" ] || die "Bootstrap plan is missing"
  [ ! -L "$plan_file" ] || die "Bootstrap plan must not be a symlink"
  validate_owned_mode "$plan_file" file "Bootstrap plan"
  cat "$plan_file"
}

read_previous_current() {
  deploy_root=$1
  expected_sha=$2
  plan_value=$(read_bootstrap_plan_value "$deploy_root")
  case "$plan_value" in
    "$expected_sha":*) previous_target=${plan_value#*:} ;;
    *) die "Bootstrap plan does not match the approved SHA" ;;
  esac
  [ "$previous_target" = "NO_SAFE_PREVIOUS" ] \
    || die "Bootstrap must not retain the unreviewed existing current target for rollback"
  printf '%s' "$previous_target"
}

replace_exact_state() {
  target_path=$1
  previous_value=$2
  next_value=$3
  label=$4
  validate_exact_file "$target_path" "$previous_value" "$label"
  temporary_path="$target_path.retry.$$"
  require_absent "$temporary_path" "Temporary $label"
  (umask 077; printf '%s\n' "$next_value" > "$temporary_path")
  chmod 600 "$temporary_path"
  "$egoe_php_command" -r '
    $target = $argv[1];
    $temporary = $argv[2];
    $expected = $argv[3] . "\n";
    if (!is_file($target) || is_link($target) || file_get_contents($target) !== $expected) exit(2);
    if (!is_file($temporary) || is_link($temporary)) exit(3);
    exit(rename($temporary, $target) ? 0 : 4);
  ' "$target_path" "$temporary_path" "$previous_value" || {
    unlink "$temporary_path" 2>/dev/null || true
    die "Cannot atomically replace $label"
  }
  validate_exact_file "$target_path" "$next_value" "$label"
}

resume_bootstrap_plan() {
  deploy_root=$1
  expected_sha=$2
  plan_file="$deploy_root/state/bootstrap-plan"
  old_plan=$(read_bootstrap_plan_value "$deploy_root")
  old_sha=${old_plan%%:*}
  [ "$old_plan" = "$old_sha:NO_SAFE_PREVIOUS" ] || die "Existing bootstrap plan has an unsupported format"
  validate_sha "$old_sha"
  [ "$old_sha" != "$expected_sha" ] || die "Bootstrap plan retry does not change the reviewed SHA"

  [ -d "$live_root" ] && [ ! -L "$live_root" ] || die "A new bootstrap SHA is allowed only after physical-live rollback"
  validate_owned_mode "$live_root" directory "Rolled-back physical document root"
  [ -f "$live_root/index.html" ] || die "Rolled-back physical document root has no index.html"
  require_absent "$legacy_backup" "Recoverable document-root backup during bootstrap retry"

  old_target="releases/safe-baseline-$old_sha"
  [ -L "$deploy_root/current" ] || die "Bootstrap retry requires the previous safe current symlink"
  [ "$(readlink "$deploy_root/current")" = "$old_target" ] || die "Bootstrap retry current is not the planned previous safe baseline"
  verify_fail_closed_baseline "$deploy_root/$old_target"

  replace_exact_state \
    "$plan_file" \
    "$old_plan" \
    "$expected_sha:NO_SAFE_PREVIOUS" \
    "bootstrap plan"
  read_previous_current "$deploy_root" "$expected_sha" >/dev/null
}

verify_bootstrap_state() {
  deploy_root=$1
  expected_sha=$2
  index_hash=$3
  htaccess_hash=$4
  phase=$5
  expected_target="releases/safe-baseline-$expected_sha"
  final_release="$deploy_root/$expected_target"

  read_previous_current "$deploy_root" "$expected_sha" >/dev/null
  verify_baseline "$final_release" "$index_hash" "$htaccess_hash"
  [ -L "$deploy_root/current" ] || die "Current must be a symlink"
  [ "$(readlink "$deploy_root/current")" = "$expected_target" ] || die "Current does not point to the safe baseline"
  [ -L "$live_root" ] || die "Live document root must be a symlink"
  [ "$(readlink "$live_root")" = "$deploy_root/current" ] || die "Live document root points outside the release switch"
  [ -d "$legacy_backup" ] || die "Recoverable physical document-root backup is missing"
  [ ! -L "$legacy_backup" ] || die "Recoverable document-root backup must not be a symlink"
  validate_owned_mode "$legacy_backup" directory "Recoverable physical document-root backup"
  [ -f "$legacy_backup/index.html" ] || die "Recoverable document-root backup has no index.html"

  production_marker="$deploy_root/state/production-enabled"
  case "$phase" in
    prepared) require_absent "$production_marker" "Production enable marker" ;;
    enabled) validate_exact_file "$production_marker" "$expected_hostname" "production enable marker" ;;
    *) die "Unknown verification phase" ;;
  esac
  require_absent "$deploy_root/state/collection-approved" "Collection approval marker"
}

restore_current_from_state() {
  deploy_root=$1
  expected_sha=$2
  expected_target="releases/safe-baseline-$expected_sha"
  previous_target=$(read_previous_current "$deploy_root" "$expected_sha")

  [ "$previous_target" = "NO_SAFE_PREVIOUS" ] || die "Unsafe previous current target cannot be restored"
  [ -L "$deploy_root/current" ] || die "Verified safe current link is missing during rollback"
  [ "$(readlink "$deploy_root/current")" = "$expected_target" ] \
    || die "Current changed unexpectedly; refusing rollback"
}

stage() {
  deploy_root=$1
  stage_token=$2
  validate_common "$deploy_root"
  validate_stage_token "$stage_token"
  require_absent "$deploy_root/state/production-enabled" "Production enable marker"
  acquire_lock "$deploy_root"
  stage_root="$deploy_root/incoming/bootstrap-$stage_token"
  require_absent "$stage_root" "Bootstrap staging directory"
  umask 077
  mkdir "$stage_root"
  chmod 700 "$stage_root"
  printf '%s\n' "BOOTSTRAP_STAGE_READY=$stage_token"
}

prepare_abort() {
  exit_code=$?
  trap - EXIT HUP INT TERM
  set +e

  if [ "${prepare_complete:-0}" != "1" ]; then
    if [ "${live_linked:-0}" = "1" ] && [ -L "$live_root" ] \
      && [ "$(readlink "$live_root" 2>/dev/null)" = "$deploy_root/current" ]; then
      unlink "$live_root" 2>/dev/null || true
    fi
    if [ "${restore_legacy_on_abort:-0}" = "1" ] && [ ! -e "$live_root" ] && [ ! -L "$live_root" ] \
      && [ -d "$legacy_backup" ] && [ ! -L "$legacy_backup" ]; then
      "$egoe_php_command" -r 'exit(rename($argv[1], $argv[2]) ? 0 : 1);' "$legacy_backup" "$live_root" \
        || printf '%s\n' "ERROR: failed to restore physical document root" >&2
    fi
    if [ "${current_switched:-0}" = "1" ]; then
      restore_current_from_state "$deploy_root" "$expected_sha" \
        || printf '%s\n' "ERROR: failed to restore previous current symlink" >&2
    fi
  fi

  if [ -n "${temporary_live_link:-}" ] && [ -L "$temporary_live_link" ]; then
    unlink "$temporary_live_link" 2>/dev/null || true
  fi
  if [ -n "${temporary_current_link:-}" ] && [ -L "$temporary_current_link" ]; then
    unlink "$temporary_current_link" 2>/dev/null || true
  fi
  exit "$exit_code"
}

prepare() {
  deploy_root=$1
  expected_sha=$2
  index_hash=$3
  htaccess_hash=$4
  stage_token=$5
  validate_common "$deploy_root"
  validate_sha "$expected_sha"
  validate_sha256 "$index_hash"
  validate_sha256 "$htaccess_hash"
  validate_stage_token "$stage_token"
  require_absent "$deploy_root/state/production-enabled" "Production enable marker"
  acquire_lock "$deploy_root"

  ensure_baseline "$deploy_root" "$expected_sha" "$index_hash" "$htaccess_hash" "$stage_token"
  expected_target="releases/safe-baseline-$expected_sha"

  if path_exists "$deploy_root/state/bootstrap-plan"; then
    plan_value=$(read_bootstrap_plan_value "$deploy_root")
    if [ "$plan_value" = "$expected_sha:NO_SAFE_PREVIOUS" ]; then
      read_previous_current "$deploy_root" "$expected_sha" >/dev/null
    else
      resume_bootstrap_plan "$deploy_root" "$expected_sha"
    fi
  else
    if [ -L "$deploy_root/current" ]; then
      discarded_current=$(readlink "$deploy_root/current")
      validate_release_target "$discarded_current"
      [ -d "$deploy_root/$discarded_current" ] || die "Existing current release is missing"
      [ ! -L "$deploy_root/$discarded_current" ] || die "Existing current release must not be a symlink"
    elif path_exists "$deploy_root/current"; then
      die "Current exists but is not a symlink"
    fi
    write_once "$deploy_root/state/bootstrap-plan" "$expected_sha:NO_SAFE_PREVIOUS" "bootstrap plan"
  fi

  prepare_complete=0
  current_switched=0
  live_linked=0
  restore_legacy_on_abort=0
  temporary_current_link=
  temporary_live_link=
  trap prepare_abort EXIT HUP INT TERM

  if [ -L "$deploy_root/current" ] && [ "$(readlink "$deploy_root/current")" = "$expected_target" ]; then
    :
  else
    if path_exists "$deploy_root/current"; then
      [ -L "$deploy_root/current" ] || die "Current exists but is not a symlink"
      current_target=$(readlink "$deploy_root/current")
      validate_release_target "$current_target"
      [ -d "$deploy_root/$current_target" ] || die "Current release is missing"
      [ ! -L "$deploy_root/$current_target" ] || die "Current release must not be a symlink"
    fi
    temporary_current_link="$deploy_root/current.bootstrap-next.$$"
    require_absent "$temporary_current_link" "Temporary current link"
    ln -s "$expected_target" "$temporary_current_link"
    replace_with_symlink "$temporary_current_link" "$deploy_root/current"
    temporary_current_link=
    current_switched=1
  fi

  if path_exists "$legacy_root"; then
    [ -d "$legacy_root" ] || die "Legacy root is not a directory"
    [ ! -L "$legacy_root" ] || die "Legacy root must not be a symlink"
    validate_owned_mode "$legacy_root" directory "Legacy root"
    chmod 700 "$legacy_root"
  else
    umask 077
    mkdir "$legacy_root"
    chmod 700 "$legacy_root"
  fi

  if [ -d "$live_root" ] && [ ! -L "$live_root" ]; then
    require_absent "$legacy_backup" "Recoverable physical document-root backup"
    validate_owned_mode "$live_root" directory "Physical document root"
    [ -f "$live_root/index.html" ] || die "Physical document root has no index.html"
    temporary_live_link="$live_root.bootstrap-next.$$"
    require_absent "$temporary_live_link" "Temporary live document-root link"
    ln -s "$deploy_root/current" "$temporary_live_link"
    restore_legacy_on_abort=1
    live_linked=1
    rename_absent "$live_root" "$legacy_backup"
    rename_absent "$temporary_live_link" "$live_root"
    temporary_live_link=
  elif [ -L "$live_root" ]; then
    [ "$(readlink "$live_root")" = "$deploy_root/current" ] || die "Live document root points to an unexpected target"
    [ -d "$legacy_backup" ] && [ ! -L "$legacy_backup" ] || die "Recoverable physical document-root backup is missing"
  elif ! path_exists "$live_root"; then
    [ -d "$legacy_backup" ] && [ ! -L "$legacy_backup" ] || die "Neither live document root nor recoverable backup is available"
    temporary_live_link="$live_root.bootstrap-next.$$"
    require_absent "$temporary_live_link" "Temporary live document-root link"
    ln -s "$deploy_root/current" "$temporary_live_link"
    restore_legacy_on_abort=1
    live_linked=1
    rename_absent "$temporary_live_link" "$live_root"
    temporary_live_link=
  else
    die "Live document root has an unsupported type"
  fi

  verify_bootstrap_state "$deploy_root" "$expected_sha" "$index_hash" "$htaccess_hash" prepared
  prepare_complete=1
  trap - EXIT HUP INT TERM
  printf '%s\n' "BOOTSTRAP_PREPARED_SHA=$expected_sha"
}

verify_state() {
  deploy_root=$1
  expected_sha=$2
  index_hash=$3
  htaccess_hash=$4
  phase=$5
  validate_common "$deploy_root"
  validate_sha "$expected_sha"
  validate_sha256 "$index_hash"
  validate_sha256 "$htaccess_hash"
  acquire_lock "$deploy_root"
  verify_bootstrap_state "$deploy_root" "$expected_sha" "$index_hash" "$htaccess_hash" "$phase"
  printf '%s\n' "BOOTSTRAP_VERIFIED_PHASE=$phase"
}

enable_production() {
  deploy_root=$1
  expected_sha=$2
  index_hash=$3
  htaccess_hash=$4
  validate_common "$deploy_root"
  validate_sha "$expected_sha"
  validate_sha256 "$index_hash"
  validate_sha256 "$htaccess_hash"
  acquire_lock "$deploy_root"

  production_marker="$deploy_root/state/production-enabled"
  if path_exists "$production_marker"; then
    verify_bootstrap_state "$deploy_root" "$expected_sha" "$index_hash" "$htaccess_hash" enabled
    printf '%s\n' "PRODUCTION_ALREADY_ENABLED_SHA=$expected_sha"
    return
  fi

  verify_bootstrap_state "$deploy_root" "$expected_sha" "$index_hash" "$htaccess_hash" prepared
  write_once "$production_marker" "$expected_hostname" "production enable marker"
  verify_bootstrap_state "$deploy_root" "$expected_sha" "$index_hash" "$htaccess_hash" enabled
  printf '%s\n' "PRODUCTION_ENABLED_SHA=$expected_sha"
}

rollback_abort() {
  exit_code=$?
  trap - EXIT HUP INT TERM
  set +e

  if [ "${rollback_complete:-0}" != "1" ] && ! path_exists "$live_root" \
    && [ -n "${fallback_link:-}" ] && [ -L "$fallback_link" ]; then
    if "$egoe_php_command" -r '
      exit(is_link($argv[1]) && !file_exists($argv[2]) && !is_link($argv[2])
        && rename($argv[1], $argv[2]) ? 0 : 1);
    ' "$fallback_link" "$live_root"; then
      printf '%s\n' "ERROR: rollback interrupted; safe baseline restored at the live path" >&2
    else
      printf '%s\n' "ERROR: rollback interrupted and the safe live symlink could not be restored" >&2
    fi
  fi

  if [ -n "${fallback_link:-}" ] && [ -L "$fallback_link" ]; then
    unlink "$fallback_link" 2>/dev/null || true
  fi
  exit "$exit_code"
}

rollback_bootstrap() {
  deploy_root=$1
  expected_sha=$2
  index_hash=$3
  htaccess_hash=$4
  validate_common "$deploy_root"
  validate_sha "$expected_sha"
  validate_sha256 "$index_hash"
  validate_sha256 "$htaccess_hash"
  require_absent "$deploy_root/state/production-enabled" "Production enable marker"
  acquire_lock "$deploy_root"

  read_previous_current "$deploy_root" "$expected_sha" >/dev/null
  verify_baseline "$deploy_root/releases/safe-baseline-$expected_sha" "$index_hash" "$htaccess_hash"
  previous_target=$(read_previous_current "$deploy_root" "$expected_sha")

  if [ -d "$live_root" ] && [ ! -L "$live_root" ] && ! path_exists "$legacy_backup"; then
    restore_current_from_state "$deploy_root" "$expected_sha"
    printf '%s\n' "BOOTSTRAP_ALREADY_ROLLED_BACK_SHA=$expected_sha"
    return
  fi

  [ -L "$live_root" ] || die "Live document root is not the bootstrap symlink"
  [ "$(readlink "$live_root")" = "$deploy_root/current" ] || die "Live document root points to an unexpected target"
  [ -d "$legacy_backup" ] && [ ! -L "$legacy_backup" ] || die "Recoverable physical document-root backup is missing"

  rollback_complete=0
  fallback_link="$live_root.bootstrap-fallback.$$"
  trap rollback_abort EXIT HUP INT TERM
  require_absent "$fallback_link" "Temporary live fallback link"
  ln -s "$deploy_root/current" "$fallback_link"
  unlink "$live_root"
  if ! "$egoe_php_command" -r '
    if (!is_dir($argv[1]) || is_link($argv[1]) || file_exists($argv[2]) || is_link($argv[2])) exit(2);
    exit(rename($argv[1], $argv[2]) ? 0 : 3);
  ' "$legacy_backup" "$live_root"; then
    die "Cannot restore physical document root; safe baseline kept live"
  fi
  restore_current_from_state "$deploy_root" "$expected_sha"
  [ -d "$live_root" ] && [ ! -L "$live_root" ] || die "Physical document root restore verification failed"
  rollback_complete=1
  unlink "$fallback_link"
  fallback_link=
  trap - EXIT HUP INT TERM
  printf '%s\n' "BOOTSTRAP_ROLLED_BACK_SHA=$expected_sha"
}

action=${1:-}
case "$action" in
  stage)
    [ "$#" -eq 3 ] || die "Usage: bootstrap-production.sh stage DEPLOY_ROOT STAGE_TOKEN"
    stage "$2" "$3"
    ;;
  prepare)
    [ "$#" -eq 6 ] || die "Usage: bootstrap-production.sh prepare DEPLOY_ROOT SHA INDEX_SHA256 HTACCESS_SHA256 STAGE_TOKEN"
    prepare "$2" "$3" "$4" "$5" "$6"
    ;;
  verify)
    [ "$#" -eq 6 ] || die "Usage: bootstrap-production.sh verify DEPLOY_ROOT SHA INDEX_SHA256 HTACCESS_SHA256 PHASE"
    verify_state "$2" "$3" "$4" "$5" "$6"
    ;;
  enable)
    [ "$#" -eq 5 ] || die "Usage: bootstrap-production.sh enable DEPLOY_ROOT SHA INDEX_SHA256 HTACCESS_SHA256"
    enable_production "$2" "$3" "$4" "$5"
    ;;
  rollback)
    [ "$#" -eq 5 ] || die "Usage: bootstrap-production.sh rollback DEPLOY_ROOT SHA INDEX_SHA256 HTACCESS_SHA256"
    rollback_bootstrap "$2" "$3" "$4" "$5"
    ;;
  *) die "Unknown action: $action" ;;
esac
