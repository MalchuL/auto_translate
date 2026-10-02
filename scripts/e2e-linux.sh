#!/usr/bin/env bash
# End-to-end check of the running app on Linux/X11.
# Requires: xclip, xdotool, xprop, xmessage and a running X session ($DISPLAY).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UD="$(mktemp -d)"
LOG="$UD/app.log"
TITLE="Clipboard Translate Overlay"
TOKEN="cto-secret-$RANDOM$RANDOM"
FAILURES=0
APP_PGID=""

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }
count() { grep -c -- "$1" "$LOG" 2>/dev/null || true; }
copy_text() { printf '%s' "$1" | xclip -selection clipboard >/dev/null 2>&1; sleep "${2:-1.2}"; }
copy_type() { printf '%s' "$2" | xclip -selection clipboard -t "$1" >/dev/null 2>&1; sleep 1.2; }
window_id() { xdotool search --name "^$TITLE\$" 2>/dev/null | head -1; }

wait_for_log() {
  for _ in $(seq 1 60); do
    grep -q -- "$1" "$LOG" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

start_app() {
  : >"$LOG"
  setsid env CTO_USER_DATA="$UD/userdata" "$ROOT/node_modules/.bin/electron" "$ROOT" "$@" >"$LOG" 2>&1 &
  APP_PGID=$!
  wait_for_log 'ready (' || { echo "app did not start"; cat "$LOG"; exit 1; }
  sleep 0.5
}

stop_app() {
  [ -n "$APP_PGID" ] && kill -- "-$APP_PGID" 2>/dev/null
  sleep 1
  APP_PGID=""
}

cleanup() {
  stop_app
  [ -n "${XMSG_PID:-}" ] && kill "$XMSG_PID" 2>/dev/null
  rm -rf "$UD"
}
trap cleanup EXIT
[ -n "${CTO_E2E_DEBUG:-}" ] && trap 'cat "$LOG" | grep cto; cat "$UD/userdata/settings.json"; cleanup' EXIT

node "$ROOT/scripts/build.mjs" || exit 1
echo "Clipboard Translate Overlay — Linux e2e (user data: $UD)"

copy_text "pre-existing $TOKEN" 0.2
start_app
sleep 1.5
check "text already in the clipboard at startup is not translated" '[ "$(count "new text")" -eq 0 ]'

copy_text "Good morning, how are you? $TOKEN" 2.5
check "new plain text triggers a translation" '[ "$(count "new text")" -eq 1 ]'
check "Google Translate page loaded" 'wait_for_log "translator: ready"'
check "window is shown for new text" '[ "$(count "window: shown")" -ge 1 ]'
WIN="$(window_id)"
check "translator window exists" '[ -n "$WIN" ]'
check "window is always on top (_NET_WM_STATE_ABOVE)" 'xprop -id "$WIN" _NET_WM_STATE | grep -q _NET_WM_STATE_ABOVE'

LOADS_BEFORE="$(count "translator: loading")"
copy_text "  Good morning, how are you? $TOKEN  "
check "identical (normalized) text does not reload" '[ "$(count "new text")" -eq 1 ] && [ "$(count "translator: loading")" -eq "$LOADS_BEFORE" ]'

xclip -selection clipboard -t image/png >/dev/null 2>&1 -i <(printf '\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\1\0\0\0\1\x08\x02\0\0\0\x90wS\xde\0\0\0\x0cIDAT\x08\xd7c\xf8\xcf\xc0\0\0\3\1\1\0\x18\xdd\x8d\xb0\0\0\0\0IEND\xaeB`\x82'); sleep 1.2
check "copying an image does not trigger a translation" '[ "$(count "new text")" -eq 1 ]'
copy_type text/uri-list "file:///etc/hostname"
check "copying a file (text/uri-list) does not trigger a translation" '[ "$(count "new text")" -eq 1 ]'
copy_type text/html "<b>html only $TOKEN</b>"
check "text/html without text/plain is ignored by default" '[ "$(count "new text")" -eq 1 ]'
copy_type application/x-custom "custom $TOKEN"
check "custom MIME types are ignored" '[ "$(count "new text")" -eq 1 ]'
copy_text "Good morning, how are you? $TOKEN"
check "same text after an image/file does not reload" '[ "$(count "new text")" -eq 1 ]'

copy_text "$(head -c 6000 /dev/zero | tr '\0' 'a')"
check "text over the length limit is skipped" '[ "$(count "too long")" -eq 1 ] && [ "$(count "new text")" -eq 1 ]'

xmessage -geometry 300x80+40+700 "focus holder" &
XMSG_PID=$!
sleep 1
XMSG_WIN="$(xdotool search --sync --name '^xmessage$' | head -1)"
xdotool windowactivate --sync "$XMSG_WIN" 2>/dev/null
sleep 0.5
ACTIVE_BEFORE="$(xdotool getactivewindow)"
copy_text "The weather is nice today. $TOKEN" 2.5
ACTIVE_AFTER="$(xdotool getactivewindow)"
check "automatic update does not steal focus" '[ "$ACTIVE_BEFORE" = "$ACTIVE_AFTER" ] && [ "$ACTIVE_AFTER" != "$WIN" ]'
check "second distinct text triggers a translation" '[ "$(count "new text")" -eq 2 ]'
kill "$XMSG_PID" 2>/dev/null; XMSG_PID=""

geometry() { xwininfo -id "$1" | awk '/Absolute upper-left X/{x=$NF} /Absolute upper-left Y/{y=$NF} /Width:/{w=$NF} /Height:/{h=$NF} END{print x, y, w, h}'; }
near() { [ $(( $1 > $2 ? $1 - $2 : $2 - $1 )) -le 3 ]; }
same_geometry() {
  set -- $1 $2
  near "$1" "$5" && near "$2" "$6" && near "$3" "$7" && near "$4" "$8"
}

xdotool windowmove --sync "$WIN" 200 150 2>/dev/null
xdotool windowsize --sync "$WIN" 600 450 2>/dev/null
sleep 1.5
GEOMETRY_BEFORE="$(geometry "$WIN")"
check "window bounds are saved to settings" 'grep -q "\"windowBounds\": {" "$UD/userdata/settings.json"'

xdotool windowactivate --sync "$WIN" key --clearmodifiers alt+F4 2>/dev/null
sleep 1
check "closing the window hides it instead of quitting" 'wait_for_log "window: hidden" && kill -0 "$APP_PGID" 2>/dev/null'

check "clipboard text is not written to disk or logs" '! grep -rq "$TOKEN" "$UD"'

for round in 1 2; do
  stop_app
  start_app
  copy_text "Restart check $round $RANDOM" 2.5
  WIN="$(window_id)"
  GEOMETRY_AFTER="$(geometry "$WIN")"
  check "position and size restored after restart #$round ($GEOMETRY_BEFORE -> $GEOMETRY_AFTER)" \
    'same_geometry "$GEOMETRY_BEFORE" "$GEOMETRY_AFTER"'
done

stop_app
start_app --host-resolver-rules="MAP translate.google.com ~NOTFOUND"
copy_text "Unreachable translate $RANDOM" 6
check "unreachable Google Translate is retried exactly once" '[ "$(count "load failed")" -eq 2 ]'
check "error state is reported after the retry" 'grep -qE "translator: (offline|error)" "$LOG"'
copy_text "Another text after the error $RANDOM" 6
check "new clipboard text starts a new load attempt" '[ "$(count "load failed")" -eq 4 ]'

echo
if [ "$FAILURES" -eq 0 ]; then echo "All checks passed"; else echo "$FAILURES check(s) failed"; fi
exit "$FAILURES"
