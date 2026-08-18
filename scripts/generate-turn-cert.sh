#!/usr/bin/env bash
# Generates a self-signed TLS cert for coturn's local TURNS/DTLS listener.
#
# Not for production — browsers reject self-signed certs for TURNS by
# default, and production needs a real CA-issued cert (e.g. Let's Encrypt)
# for the public TURN hostname. This just lets us exercise the TLS
# server-side config locally. See docs/turn.md#tls.
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
