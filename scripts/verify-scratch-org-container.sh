#!/usr/bin/env bash
# Integration test: proves the Connected App's JWT credential can actually
# authenticate as a Dev Hub and create (then delete) a scratch org — the
# specific capability External Client Apps don't support for scratch-org
# creation. Runs inside an isolated, throwaway container, same as
# verify-login-container.sh; never touches the host's ~/.sf state.
#
# The scratch org is also given --duration-days 1, so even if the delete
# step below never runs, it self-expires instead of lingering.
#
# Usage: verify-scratch-org-container.sh <username> <client-id> <key-dir> [instance-url]
set -euo pipefail

USERNAME="${1:?Usage: $0 <username> <client-id> <key-dir> [instance-url]}"
CLIENT_ID="${2:?Usage: $0 <username> <client-id> <key-dir> [instance-url]}"
KEY_DIR="${3:?Usage: $0 <username> <client-id> <key-dir> [instance-url]}"
INSTANCE_URL="${4:-https://login.salesforce.com}"
IMAGE="${SF_CI_IMAGE:-gforceinnovation/sf-ci:latest}"
CONTAINER_NAME="sf-verify-scratch-$$"
SCRATCH_DEF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scratch-org-def.json"

if [ ! -f "$KEY_DIR/server.key" ]; then
  echo "No server.key found in $KEY_DIR" >&2
  exit 1
fi

if [[ "$IMAGE" == *:latest ]]; then
  echo "WARNING: SF_CI_IMAGE is unpinned ('$IMAGE'). Pin a version tag or digest for reproducible CI runs." >&2
fi

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Verifying scratch-org creation in container '$CONTAINER_NAME' (image: $IMAGE)..."

docker run --rm \
  --name "$CONTAINER_NAME" \
  --security-opt no-new-privileges \
  --cap-drop ALL \
  -v "$KEY_DIR:/keys:ro" \
  -v "$SCRATCH_DEF:/scratch-org-def.json:ro" \
  "$IMAGE" \
  bash -c '
    set -euo pipefail
    sf org login jwt \
      --username "$1" \
      --jwt-key-file /keys/server.key \
      --client-id "$2" \
      --instance-url "$3" \
      --alias verify-devhub \
      --set-default-dev-hub

    sf org create scratch \
      --target-dev-hub verify-devhub \
      --definition-file /scratch-org-def.json \
      --alias verify-scratch \
      --duration-days 1 \
      --no-namespace \
      --json

    sf org delete scratch --target-org verify-scratch --no-prompt
  ' _ "$USERNAME" "$CLIENT_ID" "$INSTANCE_URL"

echo "Scratch-org creation verified for Dev Hub '$USERNAME'."
