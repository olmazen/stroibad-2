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
  [ "$1" != "/" ] || die "Refusing to use filesystem root"
  [ -d "$1" ] || die "Deploy root does not exist: $1"
  [ -f "$1/state/site-hostname" ] || die "Missing site-hostname marker"
  [ "$(cat "$1/state/site-hostname")" = "egoe-life.ru" ] || die "Unexpected site marker"
}

validate_sha() {
  printf '%s' "$1" | grep -Eq '^[0-9a-f]{40}$' || die "Invalid commit SHA"
}

verify_release_commit() {
  manifest=$1
  expected_sha=$2
  "$egoe_php_command" -r '
    $manifest = json_decode(file_get_contents($argv[1]), true, 512, JSON_THROW_ON_ERROR);
    if (($manifest["schemaVersion"] ?? null) !== 1) exit(2);
    if (($manifest["source"]["commit"] ?? null) !== $argv[2]) exit(3);
    if (($manifest["source"]["dirty"] ?? null) !== false) exit(4);
  ' "$manifest" "$expected_sha" || die "Release manifest provenance check failed"
}

replace_symlink() {
  source_link=$1
  target_path=$2
  "$egoe_php_command" -r '
    if (!is_link($argv[1])) exit(2);
    if (!rename($argv[1], $argv[2])) exit(3);
  ' "$source_link" "$target_path" || die "Atomic symlink switch failed"
}

preflight() {
  deploy_root=$1
  validate_root "$deploy_root"
  for command_name in tar sha256sum "$egoe_php_command" ln mv readlink grep; do
    require_command "$command_name"
  done
  [ -w "$deploy_root" ] || die "Deploy root is not writable"
  [ -d "$deploy_root/incoming" ] || die "Missing incoming directory"
  [ -d "$deploy_root/releases" ] || die "Missing releases directory"
  [ -d "$deploy_root/state" ] || die "Missing state directory"
  df -h "$deploy_root"
  printf '%s\n' "PREFLIGHT_OK"
}

deploy() {
  deploy_root=$1
  expected_sha=$2
  archive=$3
  expected_archive_sha=$4

  preflight "$deploy_root" >/dev/null
  validate_sha "$expected_sha"
  [ -f "$deploy_root/state/production-enabled" ] || die "Production deployment is not enabled"
  [ "$(cat "$deploy_root/state/production-enabled")" = "egoe-life.ru" ] || die "Invalid production marker"

  case "$archive" in
    "$deploy_root"/incoming/*) ;;
    *) die "Archive is outside the incoming directory" ;;
  esac
  [ -f "$archive" ] || die "Release archive does not exist"
  actual_archive_sha=$(sha256sum "$archive" | awk '{print $1}')
  [ "$actual_archive_sha" = "$expected_archive_sha" ] || die "Release archive checksum mismatch"

  final_release="$deploy_root/releases/$expected_sha"
  if [ ! -d "$final_release" ]; then
    temporary_release="$deploy_root/releases/.tmp-$expected_sha-$$"
    [ ! -e "$temporary_release" ] || die "Temporary release path already exists"
    mkdir "$temporary_release"
    trap 'rm -rf "$temporary_release"' EXIT HUP INT TERM
    tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$temporary_release"
    [ -f "$temporary_release/index.html" ] || die "Release has no index.html"
    [ -f "$temporary_release/release.json" ] || die "Release has no release.json"
    verify_release_commit "$temporary_release/release.json" "$expected_sha"
    find "$temporary_release" -type d -exec chmod 755 {} \;
    find "$temporary_release" -type f -exec chmod 644 {} \;
    mv "$temporary_release" "$final_release"
    trap - EXIT HUP INT TERM
  else
    verify_release_commit "$final_release/release.json" "$expected_sha"
  fi

  previous_target=''
  if [ -L "$deploy_root/current" ]; then
    previous_target=$(readlink "$deploy_root/current")
    case "$previous_target" in
      releases/*) ;;
      *) die "Current link points outside releases" ;;
    esac
  elif [ -e "$deploy_root/current" ]; then
    die "Current path exists but is not a symlink"
  fi

  if [ -n "$previous_target" ]; then
    printf '%s\n' "$previous_target" > "$deploy_root/state/previous"
  fi
  next_link="$deploy_root/current.next.$$"
  ln -s "releases/$expected_sha" "$next_link"
  replace_symlink "$next_link" "$deploy_root/current"
  printf '%s\n' "$expected_sha" > "$deploy_root/state/current"
  printf '%s\n' "DEPLOYED_SHA=$expected_sha"
}

rollback() {
  deploy_root=$1
  validate_root "$deploy_root"
  [ -f "$deploy_root/state/previous" ] || die "No previous release is recorded"
  previous_target=$(cat "$deploy_root/state/previous")
  case "$previous_target" in
    releases/*) ;;
    *) die "Previous release points outside releases" ;;
  esac
  [ -d "$deploy_root/$previous_target" ] || die "Previous release directory is missing"
  next_link="$deploy_root/current.rollback.$$"
  ln -s "$previous_target" "$next_link"
  replace_symlink "$next_link" "$deploy_root/current"
  previous_sha=${previous_target#releases/}
  printf '%s\n' "$previous_sha" > "$deploy_root/state/current"
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
