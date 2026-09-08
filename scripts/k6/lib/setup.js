import http from 'k6/http';

/**
 * Provisions one real developer account, project, and API key against a
 * running Raven API: the same golden path apps/api/test/app.e2e-spec.ts
 * exercises, so every load-test script hits real authenticated
 * endpoints instead of only the unauthenticated /health surface.
 *
 * Called once from setup(), against any single target: every replica
 * shares the same Postgres/Redis, so provisioning against one is
 * sufficient for the whole fleet.
 */
export function provisionApiKey(baseUrl) {
  const email = `k6-${Date.now()}-${Math.floor(Math.random() * 1e6)}@raven.local`;
  const password = 'k6-load-test-password-not-a-real-secret';

  const registerRes = http.post(
    `${baseUrl}/v1/auth/register`,
    JSON.stringify({ email, password }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (registerRes.status !== 201) {
    throw new Error(`setup: register failed (${registerRes.status}): ${registerRes.body}`);
  }
  const accessToken = registerRes.json('accessToken');

  const projectRes = http.post(
    `${baseUrl}/v1/projects`,
    JSON.stringify({ name: `k6-load-test-${Date.now()}` }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` } },
  );
  if (projectRes.status !== 201) {
    throw new Error(`setup: create project failed (${projectRes.status}): ${projectRes.body}`);
  }
  const projectId = projectRes.json('id');

  const keyRes = http.post(
    `${baseUrl}/v1/projects/${projectId}/api-keys`,
    JSON.stringify({ name: 'k6-load-test' }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` } },
  );
  if (keyRes.status !== 201) {
    throw new Error(`setup: create api key failed (${keyRes.status}): ${keyRes.body}`);
  }

  return { apiKey: keyRes.json('key'), projectId };
}
