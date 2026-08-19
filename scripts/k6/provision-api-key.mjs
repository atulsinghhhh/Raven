#!/usr/bin/env node
// Provisions one developer account, project, and API key against a
// running Raven API and prints the key to stdout — the same golden path
// apps/api/test/app.e2e-spec.ts exercises, factored out here so both
// chat-scaled-load-test.sh and a human running scripts/chat-load-test.mjs
// by hand can get a real key without registering through the dashboard.
//
// Usage: node scripts/k6/provision-api-key.mjs [baseUrl]
// (baseUrl defaults to http://localhost:4100)

const base = process.argv[2] ?? 'http://localhost:4100';

async function api(path, body, token) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new Error(`POST ${path} -> ${res.status}: ${text}`);
  }
  return parsed;
}

const email = `k6-provision-${Date.now()}-${Math.floor(Math.random() * 1e6)}@raven.local`;
const password = 'k6-load-test-password-not-a-real-secret';

const { accessToken } = await api('/v1/auth/register', { email, password });
const { id: projectId } = await api('/v1/projects', { name: `k6-load-test-${Date.now()}` }, accessToken);
const { key } = await api(`/v1/projects/${projectId}/api-keys`, { name: 'k6-load-test' }, accessToken);

process.stdout.write(key);
