#!/usr/bin/env bash
# Raven — generates a self-signed TLS certificate for coturn's local
# development TURNS/DTLS listener.
#
# This is explicitly NOT for production use — see docs/turn.md#tls for
# why (browsers reject self-signed certs for TURNS by default; production
# needs a real CA-issued certificate, e.g. via Let's Encrypt, for the
# public TURN hostname). This script only exists so the TLS *server-side*
# configuration can be exercised locally.
#
# Usage: bash scripts/generate-turn-cert.sh
set -euo pipefail

cd "$(dirname "$0")/.."
CERT_DIR="infrastructure/docker/coturn/certs"
mkdir -p "$CERT_DIR"

if [ -f "$CERT_DIR/cert.pem" ] && [ -f "$CERT_DIR/key.pem" ]; then
  echo "Certificate already exists at $CERT_DIR — skipping. Delete it first to regenerate."
  exit 0
fi

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -days 365 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

chmod 600 "$CERT_DIR/key.pem"
echo "Generated self-signed cert: $CERT_DIR/cert.pem / key.pem (365 days, CN=localhost)"
