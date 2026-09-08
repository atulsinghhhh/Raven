#!/usr/bin/env node
// Writes the REST reference pages under apps/docs/content/api/ from
// groundtruth.json, which is itself read out of apps/api's controllers.
//
// The reference is generated because the last audit found ~25 live routes
// missing from a page that called itself "the full resource map". A hand-kept
// list of 114 endpoints will always drift; a generated one cannot. Parameter
// tables come from the same `class-validator` decorators Nest enforces at
// runtime, so "required, 30–21600" in the docs and the 400 you get for passing
// 29 have one source.
//
// Prose that needs judgement — conventions, auth model, error semantics — is
// hand-written and lives outside the generated blocks. Each generated file
// says so at the top so nobody edits one by hand and loses the change.
//
//   node scripts/generate-api-reference.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'apps/docs/content');
const gt = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/docs/groundtruth.json'), 'utf8'));

const CREDENTIAL_LABEL = {
  session: 'Dashboard session (JWT)',
  apiKey: 'Project API key',
  'apiKey|chatToken': 'Project API key **or** chat token',
  rtcToken: 'RTC token',
  sfuSecret: 'SFU registration secret',
  none: 'None',
};

/**
 * Which reference page each route belongs on.
 *
 * Ordered: the first matching rule wins, so the specific
 * `/v1/projects/{projectId}/chat/...` rule has to precede the general
 * `/v1/projects` one.
 */
const GROUPS = [
  {
    slug: 'api/auth',
    title: 'Auth & Account API',
    description: 'Registration, sign-in, email verification, password reset, OAuth, and the signed-in account.',
    match: (p) => /^\/v1\/(auth|users|onboarding)\b/.test(p),
    intro: `These endpoints back the Raven dashboard and the CLI's \`raven login\`.
Your own application's users never touch them — they authenticate against
your app, and your backend mints them a [token](/authentication/tokens).`,
  },
  {
    slug: 'api/projects',
    title: 'Projects, Members & Keys API',
    description: 'Create projects, invite teammates, issue and revoke API keys, read the audit log.',
    match: (p) =>
      /^\/v1\/projects\/\{projectId\}\/(members|api-keys|audit-logs)/.test(p) || /^\/v1\/projects(\/\{id\})?$/.test(p),
    intro: `Project administration. Every one of these takes a dashboard
session, not an API key — an API key is scoped *to* a project and cannot
create or reshape one.

Role gating is described in [Roles & permissions](/production/roles-and-permissions).`,
  },
  {
    slug: 'api/rtc',
    title: 'RTC API',
    description: 'Rooms, RTC tokens, live participants, and the media-server fleet.',
    match: (p) => /^\/v1\/(rooms|rtc)\b/.test(p) || /^\/v1\/projects\/\{projectId\}\/rooms/.test(p),
    intro: `Create a room, then mint one short-lived token per participant.
A client presents that token to the signaling endpoint; it never calls these
routes itself.

See [Rooms & Participants](/rtc/rooms-and-participants) for the SDK side.`,
  },
  {
    slug: 'api/chat',
    title: 'Chat API',
    description: 'Conversations, members, messages, reactions, receipts, presence, and attachments.',
    match: (p) => /^\/v1\/chat\b/.test(p) || /^\/v1\/projects\/\{projectId\}\/chat/.test(p),
    intro: `The chat surface accepts **two** credentials and behaves differently
for each. A project API key acts as a server — full scopes, may act for any
user in the project. A chat token acts as one client — its identity and scopes
come from the signature and the request body cannot widen either.

See [Chat authentication](/chat/authentication) for what that means in practice.`,
  },
  {
    slug: 'api/live-streams',
    title: 'Live Streaming API',
    description: 'Stream lifecycle, host and co-host credentials, viewer tokens.',
    match: (p) => /^\/v1\/live-streams/.test(p) || /^\/v1\/projects\/\{projectId\}\/live-streams/.test(p),
    intro: `A stream wraps an RTC room and a chat conversation. Creating one
provisions both; minting a host or viewer credential returns tokens for both,
already shaped for \`LiveStream.join()\`.

See [Streams & lifecycle](/live-streaming/streams).`,
  },
  {
    slug: 'api/webhooks',
    title: 'Webhooks API',
    description: 'Register endpoints, inspect deliveries, enable and disable.',
    match: (p) => /webhooks/.test(p),
    intro: `Webhook endpoints are registered per project **and per
environment** — a staging endpoint never receives production events.

See [Webhooks](/webhooks) for the payload envelope, signature scheme and
retry behaviour.`,
  },
  {
    slug: 'api/observability',
    title: 'Observability API',
    description: 'Connection history, classified errors, usage metrics, dependency health, and telemetry ingest.',
    match: () => true,
    intro: `Everything here is read-only and reports what actually happened.
Nothing is fabricated: a value Raven does not know comes back \`null\` or
absent rather than as a plausible-looking guess.

Most of these exist twice — once under \`/v1/...\` for a project API key (what
the server SDKs call) and once under \`/v1/projects/{projectId}/...\` for a
dashboard session. Same data, different credential.`,
  },
];

// MDX, not Markdown: `<!-- -->` is a parse error here, so the markers are MDX
// expression comments. They render as nothing and survive the search-index
// pipeline, which also parses MDX.
const MARKER_START = '{/* generated:endpoints — do not edit by hand */}';
const MARKER_END = '{/* /generated:endpoints */}';

function esc(text) {
  return String(text).replace(/\|/g, '\\|');
}

/** A DTO field rendered as one row of constraints, straight from its validators. */
function constraints(field) {
  const parts = [];
  if (field.min !== undefined || field.max !== undefined) {
    parts.push(`${field.min ?? '−∞'}–${field.max ?? '∞'}`);
  }
  if (field.minLength !== undefined || field.maxLength !== undefined) {
    const lo = field.minLength ?? '0';
    const hi = field.maxLength ?? '∞';
    parts.push(lo === hi ? `${lo} chars` : `${lo}–${hi} chars`);
  }
  if (field.enum?.length) parts.push(field.enum.map((v) => `\`${v}\``).join(' · '));
  if (field.pattern) parts.push('pattern-checked');
  if (field.isArray) parts.push('array');
  return parts.join(', ');
}

function typeLabel(field) {
  const t = field.type.replace(/\s+/g, ' ').trim();
  if (t.endsWith('Dto')) return `[\`${t}\`](#${t.toLowerCase()})`;
  return `\`${t}\``;
}

function paramTable(route) {
  const rows = [];

  for (const name of [...new Set(route.pathParams ?? [])]) {
    rows.push(`| \`${name}\` | path | \`string\` | Yes | |`);
  }

  for (const [kind, dtoName] of [
    ['body', route.bodyDto],
    ['query', route.queryDto],
  ]) {
    if (!dtoName) continue;
    const dto = gt.dtos[dtoName];
    if (!dto) continue;
    for (const f of dto.fields) {
      const notes = [constraints(f), f.description].filter(Boolean).join(' — ');
      rows.push(`| \`${f.name}\` | ${kind} | ${typeLabel(f)} | ${f.required ? 'Yes' : 'No'} | ${esc(notes)} |`);
    }
  }

  if (!rows.length) return '_No parameters._';
  return ['| Parameter | In | Type | Required | Notes |', '|---|---|---|---|---|', ...rows].join('\n');
}

/** Nested DTOs referenced by a page's parameter tables, rendered once at the bottom. */
function nestedDtoSections(routes) {
  const referenced = new Set();
  for (const r of routes) {
    for (const dtoName of [r.bodyDto, r.queryDto].filter(Boolean)) {
      for (const f of gt.dtos[dtoName]?.fields ?? []) {
        if (f.type.endsWith('Dto') && gt.dtos[f.type]) referenced.add(f.type);
      }
    }
  }
  if (!referenced.size) return '';

  const out = ['## Nested objects', ''];
  for (const name of [...referenced].sort()) {
    const dto = gt.dtos[name];
    out.push(`### ${name}`, '');
    out.push('| Field | Type | Required | Notes |', '|---|---|---|---|');
    for (const f of dto.fields) {
      const notes = [constraints(f), f.description].filter(Boolean).join(' — ');
      const dflt = f.default && !f.default.startsWith('new ') ? ` Default \`${f.default}\`.` : '';
      out.push(`| \`${f.name}\` | ${typeLabel(f)} | ${f.required ? 'Yes' : 'No'} | ${esc(notes + dflt)} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

function endpointSection(route) {
  const out = [];
  out.push(`### ${route.method} \`${route.path}\``, '');
  if (route.summary) out.push(route.summary, '');

  const facts = [`**Credential** ${CREDENTIAL_LABEL[route.credential] ?? route.credential}`];
  if (route.rateLimitPerWindow) {
    facts.push(`**Rate limit** ${route.rateLimitPerWindow} per window ([details](/production/rate-limits))`);
  }
  if (route.idempotent) facts.push('**Idempotent** send `Idempotency-Key` to replay safely');
  out.push(facts.join(' · '), '');

  out.push(paramTable(route), '');
  return out.join('\n');
}

function generatedBlock(routes) {
  const byPrefix = new Map();
  for (const r of routes) {
    // Group by the resource the path names, so related verbs sit together.
    const key = r.path.split('/').slice(0, 4).join('/');
    if (!byPrefix.has(key)) byPrefix.set(key, []);
    byPrefix.get(key).push(r);
  }

  const out = [MARKER_START, ''];
  out.push(
    '{/* Generated by scripts/generate-api-reference.mjs from apps/api/src.',
    '    Edit the controllers or the generator, never this block. */}',
    '',
  );

  out.push('## Endpoints', '');
  out.push('| Method | Path | Credential |', '|---|---|---|');
  for (const r of routes) {
    const anchor = `#${r.method.toLowerCase()}-${r.path.replace(/[^a-z0-9]+/gi, '').toLowerCase()}`;
    out.push(`| ${r.method} | [\`${r.path}\`](${anchor}) | ${CREDENTIAL_LABEL[r.credential] ?? r.credential} |`);
  }
  out.push('');

  for (const [, group] of byPrefix) {
    for (const r of group) out.push(endpointSection(r));
  }

  const nested = nestedDtoSections(routes);
  if (nested) out.push(nested);

  out.push(MARKER_END);
  return out.join('\n');
}

function assign(routes) {
  const assigned = new Map(GROUPS.map((g) => [g.slug, []]));
  for (const r of routes) {
    // Not part of the versioned REST surface: infrastructure probes.
    if (!r.path.startsWith('/v1/')) continue;
    const group = GROUPS.find((g) => g.match(r.path));
    assigned.get(group.slug).push(r);
  }
  return assigned;
}

function writePage(group, routes) {
  const file = path.join(CONTENT, `${group.slug}.md`);
  const frontmatter = [
    '---',
    `title: ${group.title}`,
    `description: ${group.description}`,
    '---',
    '',
    group.intro,
    '',
  ].join('\n');

  const body = generatedBlock(routes);
  const footer = [
    '',
    '## Next steps',
    '',
    '- [Conventions](/api/conventions) — base path, error envelope, request ids, pagination.',
    '- [Errors](/reference/errors) — every code this API can return.',
    '- [All endpoints](/api/all-endpoints) — the whole surface on one page.',
    '',
  ].join('\n');

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${frontmatter}${body}${footer}`);
  return { slug: group.slug, endpoints: routes.length };
}

function writeAllEndpoints(routes) {
  const rows = routes
    .filter((r) => r.path.startsWith('/v1/'))
    .map((r) => {
      const group = GROUPS.find((g) => g.match(r.path));
      return `| ${r.method} | \`${r.path}\` | ${CREDENTIAL_LABEL[r.credential] ?? r.credential} | [${group.title.replace(/ API$/, '')}](/${group.slug}) |`;
    });

  const infra = routes.filter((r) => !r.path.startsWith('/v1/'));

  const page = [
    '---',
    'title: All endpoints',
    'description: Every route the Raven API serves, generated from the controllers.',
    '---',
    '',
    `Raven serves **${rows.length}** versioned endpoints under \`/v1\`, plus`,
    `**${infra.length}** unversioned infrastructure routes. This page is generated`,
    'from `apps/api`, so it is the whole surface — not a curated subset.',
    '',
    'Interactive request/response schemas are served by the API itself at `/docs`.',
    '',
    MARKER_START,
    '',
    '## Versioned API',
    '',
    '| Method | Path | Credential | Reference |',
    '|---|---|---|---|',
    ...rows,
    '',
    '## Infrastructure',
    '',
    'Not part of the versioned API and not covered by its compatibility promise.',
    '',
    '| Method | Path | Purpose |',
    '|---|---|---|',
    ...infra.map((r) => `| ${r.method} | \`${r.path}\` | ${esc(r.summary ?? '—')} |`),
    '',
    MARKER_END,
    '',
    '## Next steps',
    '',
    '- [Conventions](/api/conventions) — how to read every route above.',
    '- [Authentication](/authentication) — which credential to send.',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(CONTENT, 'api/all-endpoints.md'), page);
  return { slug: 'api/all-endpoints', endpoints: rows.length + infra.length };
}

// ---------------------------------------------------------------------------
// Environment variables and limits
//
// Both are generated for the same reason the endpoint pages are: 92 env keys
// and two dozen ceilings, hand-maintained, will drift. The audit found ten
// env vars the API reads that `.env.example` never mentioned.
// ---------------------------------------------------------------------------

const ENV_GROUPS = [
  ['Core', /^(NODE_ENV|API_PORT|API_PUBLIC_URL|APP_URL|CORS_ORIGIN|LOG_LEVEL|DOCS_URL)$/],
  ['Database', /^(DATABASE|DIRECT)_/],
  ['Redis', /^REDIS_/],
  ['Secrets & tokens', /^(JWT_|RTC_TOKEN_|CHAT_TOKEN_SECRET|API_KEY_HASH_SECRET|SFU_REGISTRATION_SECRET)/],
  ['OAuth sign-in', /^(OAUTH_|GITHUB_|GOOGLE_)/],
  ['RTC & signaling', /^(RTC_SIGNALING_URL|SIGNALING_|SFU_(?!REGISTRATION))/],
  ['TURN', /^TURN_/],
  ['Chat', /^CHAT_(?!TOKEN_SECRET)/],
  ['Attachments (object storage)', /^STORAGE_/],
  ['Webhooks', /^WEBHOOK_/],
  ['Transactional email', /^(EMAIL_|RESEND_|PASSWORD_RESET_)/],
  ['Observability', /^OBSERVABILITY_/],
  ['Rate limiting', /^RATE_LIMIT_/],
];

/** Defaults are written as expressions in configuration.ts; render them readably. */
function renderDefault(raw) {
  if (raw === undefined) return '—';
  const expr = raw.trim();
  if (/^[\d\s*+]+$/.test(expr) && /[*+]/.test(expr)) {
    // Arithmetic-only literal out of our own configuration.ts, matched by the
    // guard above: digits, spaces, `*` and `+` and nothing else.
    const value = Function(`"use strict";return (${expr})`)();
    return `\`${value}\` (${expr})`;
  }
  return `\`${expr}\``;
}

function writeEnvVars() {
  const gtConfig = gt.config;
  const all = new Set([...gtConfig.readByAnyComponent, ...gtConfig.inEnvExample]);
  const undocumented = new Set(gtConfig.readButUndocumented);
  const notRead = new Set(gtConfig.inEnvExample.filter((k) => !gtConfig.readByAnyComponent.includes(k)));
  const sfuOnly = new Set(gtConfig.readBySfu.filter((k) => !gtConfig.readByApi.includes(k)));
  const dashboardOnly = new Set(gtConfig.readByDashboard.filter((k) => !gtConfig.readByApi.includes(k)));

  const rows = (regex) =>
    [...all]
      .filter((k) => regex.test(k))
      .sort()
      .map((k) => {
        const notes = [];
        if (sfuOnly.has(k)) notes.push('read by the SFU');
        if (dashboardOnly.has(k)) notes.push('read by the dashboard');
        // In .env.example but nothing in this repository reads it: either a
        // container's own entrypoint consumes it (coturn's template does), or
        // it is stale. Said plainly rather than attributed to a guess.
        if (notRead.has(k)) notes.push('in `.env.example`, but no Raven component reads it');
        if (undocumented.has(k)) notes.push('**not in `.env.example`**');
        return `| \`${k}\` | ${notes.join('; ') || ' '} |`;
      });

  const claimed = new Set();
  const sections = [];
  for (const [title, regex] of ENV_GROUPS) {
    const list = rows(regex);
    for (const k of all) if (regex.test(k)) claimed.add(k);
    if (!list.length) continue;
    sections.push(`### ${title}`, '', '| Variable | Notes |', '|---|---|', ...list, '');
  }

  const leftover = [...all].filter((k) => !claimed.has(k)).sort();
  if (leftover.length) {
    sections.push(
      '### Other',
      '',
      '| Variable | Notes |',
      '|---|---|',
      ...leftover.map((k) => `| \`${k}\` | ${undocumented.has(k) ? 'not in `.env.example`' : ' '} |`),
      '',
    );
  }

  const page = [
    '---',
    'title: Environment variables',
    'description: Every variable any Raven component reads, grouped by what it configures. Generated from source.',
    '---',
    '',
    `Raven's components read **${gtConfig.readByAnyComponent.length}** environment variables between them —`,
    `**${gtConfig.readByApi.length}** by the control plane, **${gtConfig.readBySfu.length}** by the SFU,`,
    `**${gtConfig.readByDashboard.length}** by the dashboard. \`.env.example\` documents`,
    `**${gtConfig.inEnvExample.length}**, which leaves **${gtConfig.readButUndocumented.length}** read but`,
    'undocumented there; those are marked below.',
    '',
    'This page is generated from the source, so it is the complete set.',
    '',
    '## Start here',
    '',
    'Four of these will be wrong on a first deployment more often than the',
    'other eighty-eight:',
    '',
    '| Variable | Why it matters |',
    '|---|---|',
    '| `API_PUBLIC_URL` | Becomes `telemetryUrl` in every mint response, and the base the signaling URL is derived from. If it is the container-internal address, clients cannot reach it. |',
    '| `RTC_SIGNALING_URL` | Overrides the derived signaling address. Set it when signaling sits behind a different hostname or ingress. |',
    '| `CORS_ORIGIN` | The chat WebSocket rejects a mismatched `Origin` with close code `4403`. Never `*` in production. |',
    '| `TURN_HOST` | Host-facing, not the Docker service name. A container address here means no client can reach the relay. |',
    '',
    '## Secrets that must be set explicitly',
    '',
    '`RTC_TOKEN_SECRET` and `CHAT_TOKEN_SECRET` fall back to `JWT_SECRET` so a',
    'fresh clone boots. Production validation refuses that fallback at start-up:',
    "one credential must not be able to mint another's. Generate each",
    'independently:',
    '',
    '```bash',
    'openssl rand -hex 32   # JWT_SECRET',
    'openssl rand -hex 32   # RTC_TOKEN_SECRET',
    'openssl rand -hex 32   # CHAT_TOKEN_SECRET',
    'openssl rand -hex 32   # API_KEY_HASH_SECRET',
    'openssl rand -hex 32   # SFU_REGISTRATION_SECRET',
    'openssl rand -hex 32   # TURN_SECRET',
    '```',
    '',
    MARKER_START,
    '',
    '## All variables',
    '',
    ...sections,
    MARKER_END,
    '',
    '## Next steps',
    '',
    '- [Docker Compose](/self-hosting/docker-compose) — the stack these configure.',
    '- [Limits & quotas](/reference/limits) — the ceilings several of these set.',
    '',
  ].join('\n');

  fs.mkdirSync(path.join(CONTENT, 'self-hosting'), { recursive: true });
  fs.writeFileSync(path.join(CONTENT, 'self-hosting/environment-variables.md'), page);
  return { slug: 'self-hosting/environment-variables', endpoints: all.size };
}

const LIMIT_GROUPS = [
  [
    'RTC',
    [
      'maxParticipantsPerRoom',
      'maxMessageBytes',
      'maxMessagesPerWindow',
      'maxConnectionsPerWindow',
      'defaultTtlSeconds',
      'heartbeatTimeoutSeconds',
    ],
  ],
  [
    'Chat',
    [
      'maxTextLength',
      'maxMetadataBytes',
      'maxFrameBytes',
      'maxReactionsPerMessage',
      'maxRoomSubscriptionsPerConnection',
      'maxHistoryPageSize',
      'sendRateLimit',
      'tokenDefaultTtlSeconds',
      'tokenMaxTtlSeconds',
      'presenceTtlSeconds',
      'typingTtlSeconds',
    ],
  ],
  ['Attachments', ['maxAttachmentBytes', 'uploadUrlTtlSeconds', 'downloadUrlTtlSeconds']],
  ['Webhooks', ['maxAttempts', 'backoffBaseMs', 'timeoutMs', 'disableAfterConsecutiveFailures']],
  ['Rate limiting', ['windowSeconds']],
];

const LIMIT_LABELS = {
  maxParticipantsPerRoom: 'Participants per room',
  maxMessageBytes: 'Signaling frame size',
  maxMessagesPerWindow: 'Signaling messages per connection, per window',
  maxConnectionsPerWindow: 'Signaling connection attempts per IP, per window',
  defaultTtlSeconds: 'RTC token lifetime (default; 30–21600 allowed)',
  heartbeatTimeoutSeconds: 'Media-server heartbeat timeout',
  maxTextLength: 'Message text characters',
  maxMetadataBytes: 'Message metadata bytes',
  maxFrameBytes: 'Chat WebSocket frame bytes',
  maxReactionsPerMessage: 'Reactions per message',
  maxRoomSubscriptionsPerConnection: 'Conversations per chat connection',
  maxHistoryPageSize: 'Message history page size',
  sendRateLimit: 'Chat sends per user, per window',
  tokenDefaultTtlSeconds: 'Chat token lifetime (default)',
  tokenMaxTtlSeconds: 'Chat token lifetime (maximum)',
  presenceTtlSeconds: 'Presence key TTL — expiry is the offline transition',
  typingTtlSeconds: 'Typing indicator TTL',
  maxAttachmentBytes: 'Attachment size',
  uploadUrlTtlSeconds: 'Signed upload URL lifetime',
  downloadUrlTtlSeconds: 'Signed download URL lifetime',
  maxAttempts: 'Webhook delivery attempts',
  backoffBaseMs: 'Webhook retry backoff base',
  timeoutMs: 'Webhook delivery timeout',
  disableAfterConsecutiveFailures: 'Consecutive failures before an endpoint is disabled',
  windowSeconds: 'Rate-limit window',
};

function writeLimits() {
  const rateLimited = gt.routes.filter((r) => r.rateLimitPerWindow).sort((a, b) => a.path.localeCompare(b.path));

  const sections = [];
  for (const [title, keys] of LIMIT_GROUPS) {
    const rows = keys
      .filter((k) => gt.limits[k])
      .map((k) => `| ${LIMIT_LABELS[k] ?? k} | ${renderDefault(gt.limits[k].default)} | \`${gt.limits[k].env}\` |`);
    if (!rows.length) continue;
    sections.push(`### ${title}`, '', '| Limit | Default | Configured by |', '|---|---|---|', ...rows, '');
  }

  const page = [
    '---',
    'title: Limits & quotas',
    'description: Every ceiling and TTL a developer meets, with the variable that sets it. Generated from the API configuration.',
    '---',
    '',
    "Every value below is a **default**, read out of the API's configuration. A",
    'self-hosted deployment can change any of them; a hosted one has whatever',
    'its operator set.',
    '',
    'Nothing here is a billing quota — Raven has no usage metering.',
    '',
    MARKER_START,
    '',
    '## Ceilings and TTLs',
    '',
    ...sections,
    '## Rate-limited endpoints',
    '',
    `**${rateLimited.length}** routes carry a per-window budget. The window itself is`,
    `${renderDefault(gt.limits.windowSeconds?.default)} seconds.`,
    '',
    '| Endpoint | Per window |',
    '|---|---|',
    ...rateLimited.map((r) => `| ${r.method} \`${r.path}\` | ${r.rateLimitPerWindow} |`),
    '',
    MARKER_END,
    '',
    '## What a limit looks like when you hit it',
    '',
    'A REST limit returns `429` with `RAVEN_RATE_LIMITED` and a',
    '`retryAfterSeconds` field — use it rather than a fixed backoff. A chat',
    'limit arrives as a `RATE_LIMITED` error frame carrying the same field. A',
    'signaling connection limit closes the socket with code `4429`.',
    '',
    '## Next steps',
    '',
    '- [Rate limits](/production/rate-limits) — what the budget is keyed on.',
    '- [Errors](/reference/errors) · [Environment variables](/self-hosting/environment-variables)',
    '',
  ].join('\n');

  fs.mkdirSync(path.join(CONTENT, 'reference'), { recursive: true });
  fs.writeFileSync(path.join(CONTENT, 'reference/limits.md'), page);
  return { slug: 'reference/limits', endpoints: rateLimited.length };
}

function main() {
  const assigned = assign(gt.routes);
  const written = [];

  for (const group of GROUPS) {
    const routes = assigned.get(group.slug);
    if (!routes.length) {
      process.stderr.write(`warn: no routes matched ${group.slug}\n`);
      continue;
    }
    written.push(writePage(group, routes));
  }
  written.push(writeAllEndpoints(gt.routes));
  written.push(writeEnvVars());
  written.push(writeLimits());

  for (const w of written) {
    process.stdout.write(`  ${w.slug.padEnd(24)} ${String(w.endpoints).padStart(3)} endpoints\n`);
  }
  const total = gt.routes.filter((r) => r.path.startsWith('/v1/')).length;
  process.stdout.write(`\n${total} versioned endpoints documented across ${GROUPS.length} pages\n`);
}

main();
