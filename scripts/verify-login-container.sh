#!/usr/bin/env bash
# Integration test: proves the External Client App actually works by running
# `sf org login jwt` inside an isolated, throwaway container. Never touches
# the host's ~/.sf state — a failed or successful attempt here can't corrupt
# any locally-authenticated org.
#
# Usage: verify-login-container.sh <username> <client-id> <key-dir> [instance-url]
set -euo pipefail

USERNAME="${1:?Usage: $0 <username> <client-id> <key-dir> [instance-url]}"
CLIENT_ID="${2:?Usage: $0 <username> <client-id> <key-dir> [instance-url]}"
KEY_DIR="${3:?Usage: $0 <username> <client-id> <key-dir> [instance-url]}"
INSTANCE_URL="${4:-https://login.salesforce.com}"
IMAGE="${SF_CI_IMAGE:-gforceinnovation/sf-ci:latest}"

if [ ! -f "$KEY_DIR/server.key" ]; then
  echo "No server.key found in $KEY_DIR" >&2
  exit 1
fi

docker run --rm \
  -v "$KEY_DIR:/keys:ro" \
  "$IMAGE" \
  bash -c '
    set -euo pipefail
    sf org login jwt \
      --username "$1" \
      --jwt-key-file /keys/server.key \
      --client-id "$2" \
      --instance-url "$3" \
      --alias verify \
    && sf org display --target-org verify --json
  ' _ "$USERNAME" "$CLIENT_ID" "$INSTANCE_URL"
