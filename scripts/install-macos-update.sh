#!/bin/sh
# One authorization covers installation and a possible startup-failure rollback.
set -eu
target=$1
archive=$2
expected_digest=$3
version=$4
identifier=$5
token=$6
caller_uid=$7
parent_pid=$8
case "$token" in macos-update-startup-*) ;; *) exit 1 ;; esac
case "$token" in *[!a-zA-Z0-9-]*|'') exit 1 ;; esac
case "$caller_uid:$parent_pid" in *[!0-9:]*|:*|*:) exit 1 ;; esac
[ "${#expected_digest}" -eq 64 ]
case "$expected_digest" in *[!0-9a-f]*) exit 1 ;; esac
parent=$(dirname "$target")
identity=$(printf '%s' "$target" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')
backup="$parent/.pymss-studio-previous-$identity.app"
control="/private/tmp/pymss-studio-authorized-$token"
umask 077
# The root-owned directory in sticky /private/tmp cannot be replaced by the caller.
/bin/mkdir -m 755 "$control"
/bin/mkdir -m 700 "$control/private"
printf 'preparing' > "$control/status"
/bin/chmod 644 "$control/status"
printf '%64s' '' > "$control/outcome"
/usr/sbin/chown "$caller_uid" "$control/outcome"
/bin/chmod 600 "$control/outcome"
stage=
staged=
actual_backup="$backup"
phase=preparing

validate_bundle() {
    [ ! -L "$1" ] || return 1
    [ -d "$1" ] || return 1
    [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$1/Contents/Info.plist")" = "$identifier" ] || return 1
    /usr/bin/codesign --verify --deep --strict "$1"
}

exchange() {
    /usr/bin/osascript -l JavaScript -e 'function run(argv) { ObjC.import("stdio"); return $.renamex_np(argv[0], argv[1], 2) === 0 ? "swapped" : "failed"; }' "$1" "$2"
}

rollback() {
    phase=recovering
    validate_bundle "$actual_backup" || return 1
    [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$actual_backup/Contents/Info.plist")" = "$old_version" ] || return 1
    if [ -e "$target" ]; then
        result=$(exchange "$target" "$actual_backup") || return 1
        case "$result" in
            swapped) ;;
            failed)
                /bin/mv "$target" "$control/private/failed.app" || return 1
                if ! /bin/mv "$actual_backup" "$target"; then
                    /bin/mv "$control/private/failed.app" "$target" || :
                    return 1
                fi
                actual_backup="$control/private/failed.app"
                ;;
            *) return 1 ;;
        esac
    else
        /bin/mv "$actual_backup" "$target" || return 1
        actual_backup=
    fi
    validate_bundle "$target" || return 1
    if [ -n "$actual_backup" ]; then /bin/rm -rf "$actual_backup" || :; fi
    phase=rolledback
    printf 'rolledback' > "$control/status"
}

finish() {
    status=$?
    trap - 0 HUP INT TERM
    if [ "$phase" = installed ]; then rollback || status=1; fi
    if [ "$phase" = preparing ]; then
        if [ -n "$stage" ] && [ -d "$stage/obsolete.app" ] && [ ! -e "$backup" ]; then
            /bin/mv "$stage/obsolete.app" "$backup" || :
        fi
        printf 'failed' > "$control/status" || :
    fi
    if [ "$phase" = exchanging ] || [ "$phase" = recovering ]; then
        printf 'failed' > "$control/status" || :
        echo "Application replacement did not complete; recovery files are preserved at $stage" >&2
    fi
    /bin/rm -rf "$control/private" || :
    if [ "$phase" = preparing ] || [ "$phase" = rolledback ]; then
        if [ -n "$stage" ]; then /bin/rm -rf "$stage" || :; fi
    elif [ "$phase" = committed ] && [ -n "$stage" ]; then
        /bin/rm -rf "$stage/obsolete.app" || :
        /bin/rmdir "$stage" 2>/dev/null || :
    fi
    i=0
    while [ "$i" -lt 25 ]; do
        [ "$(/usr/bin/head -c 64 "$control/outcome" | /usr/bin/awk '{print $1}')" != observed ] || break
        i=$((i + 1)); /bin/sleep 0.2
    done
    /bin/rm -rf "$control" || :
    exit "$status"
}
trap finish 0
trap 'exit 1' HUP INT TERM

# Hash and unpack a root-owned snapshot, never the caller's mutable extracted app.
/bin/cp "$archive" "$control/private/update.app.tar.gz"
actual_digest=$(/usr/bin/shasum -a 256 "$control/private/update.app.tar.gz" | /usr/bin/awk '{print $1}')
[ "$actual_digest" = "$expected_digest" ] || { echo 'The verified update archive changed before authorization.' >&2; exit 1; }
/bin/mkdir "$control/private/extracted"
(umask 022; /usr/bin/tar --no-same-owner --no-same-permissions -xzf "$control/private/update.app.tar.gz" -C "$control/private/extracted")
source="$control/private/extracted/Pymss Studio.app"
validate_bundle "$source"
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$source/Contents/Info.plist")" = "$version" ]
validate_bundle "$target"
old_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$target/Contents/Info.plist")
/bin/kill -0 "$parent_pid" 2>/dev/null || exit 1
stage=$(/usr/bin/mktemp -d "$parent/.pymss-studio-update-XXXXXXXX")
staged="$stage/Pymss Studio.app"
/usr/bin/ditto "$source" "$staged"
validate_bundle "$staged"
if [ -e "$backup" ] || [ -L "$backup" ]; then
    validate_bundle "$backup"
    /bin/mv "$backup" "$stage/obsolete.app"
fi

phase=exchanging
result=$(exchange "$staged" "$target") || exit 1
case "$result" in
    swapped)
        if ! /bin/mv "$staged" "$backup"; then actual_backup="$staged"; fi
        ;;
    failed)
        /bin/mv "$target" "$backup"
        if ! /bin/mv "$staged" "$target"; then
            /bin/mv "$backup" "$target" || echo "The previous application is preserved at $backup" >&2
            exit 1
        fi
        ;;
    *) exit 1 ;;
esac
phase=installed
printf '%s' "$actual_backup" > "$control/backup"
/bin/chmod 644 "$control/backup"
printf 'installed' > "$control/status"

# The caller may write this regular file but cannot replace it with a symlink/FIFO.
i=0
while [ "$i" -lt 600 ]; do
    outcome=$(/usr/bin/head -c 64 "$control/outcome" | /usr/bin/awk '{print $1}')
    case "$outcome" in
        commit)
            printf 'committed' > "$control/status"
            phase=committed
            exit 0
            ;;
        rollback) rollback; exit 0 ;;
        ready:*)
            child_pid=${outcome#ready:}
            case "$child_pid" in ''|*[!0-9]*) exit 1 ;; esac
            if ! /bin/kill -0 "$parent_pid" 2>/dev/null && /bin/kill -0 "$child_pid" 2>/dev/null; then
                printf 'committed' > "$control/status"
                phase=committed
                exit 0
            fi
            ;;
        '') /bin/kill -0 "$parent_pid" 2>/dev/null || exit 1 ;;
        *) exit 1 ;;
    esac
    i=$((i + 1))
    /bin/sleep 0.2
done
echo 'Application startup confirmation timed out; restoring the previous version.' >&2
exit 1
