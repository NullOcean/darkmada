#!/usr/bin/env bash

set -euo pipefail

if ! tailscale --version >/dev/null 2>&1; then
    echo "Tailscale is missing or could not run." >&2
    exit 1
fi

echo "Tailscale is available. Enabling tailscaled..." >&2
systemctl enable --now tailscaled >&2

# Keep stdout machine-readable. The store reads the JSON objects emitted by
# `tailscale up --json` while it waits for browser authentication.
exec tailscale up --json
