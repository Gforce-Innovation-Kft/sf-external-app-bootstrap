#!/usr/bin/env bash
# Generates a self-signed JWT bearer-flow keypair for a given environment name.
# Usage: generate-keypair.sh <env> [--force]
set -euo pipefail

ENV_NAME="${1:-}"
FORCE="${2:-}"

if [ -z "$ENV_NAME" ]; then
  echo "Usage: $0 <env> [--force]" >&2
  exit 1
fi

KEY_DIR="$HOME/.sf-jwt/$ENV_NAME"
KEY_FILE="$KEY_DIR/server.key"
CERT_FILE="$KEY_DIR/server.crt"

if [ -f "$KEY_FILE" ] && [ -f "$CERT_FILE" ] && [ "$FORCE" != "--force" ]; then
  echo "Keypair already exists at $KEY_DIR (use --force to overwrite)." >&2
  exit 1
fi

mkdir -p "$KEY_DIR"
umask 077

openssl req -newkey rsa:2048 -nodes \
  -keyout "$KEY_FILE" \
  -x509 -days 730 \
  -out "$CERT_FILE" \
  -subj "/CN=$ENV_NAME.gforceinnovation.com/O=GForce Innovation/C=ES"

chmod 600 "$KEY_FILE"
chmod 644 "$CERT_FILE"

echo "Generated $KEY_FILE and $CERT_FILE"
