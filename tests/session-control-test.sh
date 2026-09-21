#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CONTROL="$ROOT/system_files/usr/libexec/armada/session-control"

bash -n "$CONTROL"

for text in \
    'desktop-handoff)' \
    'systemctl --user stop graphical-session.target' \
    '--unit=armada-desktop-handoff' \
    '/usr/libexec/armada/session-control desktop-handoff' \
    'systemctl restart sddm.service'; do
    grep -Fq -- "$text" "$CONTROL" >/dev/null || {
        printf 'missing desktop handoff behavior: %s\n' "$text" >&2
        exit 1
    }
done

printf 'session-control handoff test passed\n'
