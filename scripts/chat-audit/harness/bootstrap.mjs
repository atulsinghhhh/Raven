// Phase 2 steps 1-3: create a project as an external developer would.
import { http, must } from './lib.mjs';
import { writeFileSync } from 'fs';

const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const email = `audit-${suffix}@raven.local`;
const password = 'correct-horse-battery-staple';

const reg = must(await http('/v1/auth/register', { method: 'POST', body: { email, password } }), 201, 'register');
const jwt = reg.accessToken;
const proj = must(
  await http('/v1/projects', { method: 'POST', token: jwt, body: { name: `audit-${suffix}` } }),
  201,
  'create project',
);
const key = must(
  await http(`/v1/projects/${proj.id}/api-keys`, { method: 'POST', token: jwt, body: { name: 'audit' } }),
  201,
  'create api key',
);

const out = {
  suffix,
  email,
  jwt,
  projectId: proj.id,
  apiKey: key.key,
  base: process.env.RAVEN_BASE ?? 'http://localhost:4177',
};
writeFileSync(new URL('./ctx.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ projectId: proj.id, apiKeyPrefix: key.key.slice(0, 12), email }, null, 2));
