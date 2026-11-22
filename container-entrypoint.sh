#!/bin/bash
set -euo pipefail

# Separate process groups let shutdown reach npm's Node child as well.
set -m
npm start &
app_pid=$!
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
caddy_pid=$!
cleanup() {
  trap - EXIT INT TERM
  kill -TERM -- "-$app_pid" "-$caddy_pid" 2>/dev/null || true
  wait "$app_pid" "$caddy_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
# Shut down the other service if either exits, including startup failures.
set +e
wait -n "$app_pid" "$caddy_pid"
status=$?
set -e
if [ "$status" -eq 0 ]; then status=1; fi
exit "$status"
