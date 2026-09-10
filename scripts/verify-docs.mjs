#!/usr/bin/env node
// Checks the documentation against the code it describes.
//
// The published docs once drifted two weeks behind the implementation while
// every test stayed green, because nothing compared the two. This does:
//
//   1. every `METHOD /v1/...` in the prose resolves to a real route
//   2. every `RAVEN_*` code exists in the API's error vocabulary
//   3. every symbol imported from a Livqeno package is actually exported
//   4. every `raven <command>` is registered on the CLI
//   5. every `RAVEN_*`/config env var referenced is one the API reads
//   6. internal links and heading anchors resolve
//   7. every redirect points at a page, and shadows none
//   8. the sidebar and the content tree agree
//
// Findings are errors, not warnings: a documented API that does not exist
// costs a developer more than a broken build costs us. Where a check cannot
// be certain — a deliberately-absent API named in prose, a third-party env
// var — the pattern is allow-listed inline with the reason, so an exception
// is a decision on the record rather than a hole in the net.
//
//   node scripts/verify-docs.mjs [--json]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'apps/docs/content');
const GROUNDTRUTH = path.join(ROOT, 'apps/docs/groundtruth.json');

const failures = [];
const counts = {};

function fail(check, file, message) {
  failures.push({ check, file, message });
}

function bump(check, n = 1) {
  counts[check] = (counts[check] ?? 0) + n;
}

function contentFiles() {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), [...prefix, entry.name]);
      else if (entry.name.endsWith('.md')) out.push([...prefix, entry.name.replace(/\.md$/, '')].join('/'));
    }
  };
  walk(CONTENT, []);
  return out.sort();
}

function readSlug(slug) {
  return fs.readFileSync(path.join(CONTENT, `${slug}.md`), 'utf8');
}

/** Fenced code blocks, so a check can look only at code or only at prose. */
function codeBlocks(text) {
  return [...text.matchAll(/```([a-zA-Z]*)\n([\s\S]*?)```/g)].map((m) => ({ lang: m[1], body: m[2] }));
}

// ---------------------------------------------------------------------------
// 1. REST routes
// ---------------------------------------------------------------------------

/**
 * Route templates as regexes, `{param}` matching one path segment.
 *
 * Docs cite routes three ways — a bare template (`/v1/rooms/{roomId}`), a
 * shell variable (`/v1/live-streams/$STREAM_ID`), and a real id pasted from a
 * terminal (`/v1/live-streams/stream_jRoD1T3EXh0PMJRGG4zYzQ/end`). All three
 * are one segment where the template has a parameter, so one matcher covers
 * them without the docs having to pick a single style.
 */
function routeMatchers(routes) {
  return routes.map((r) => ({
    route: r,
    re: new RegExp(`^${r.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[A-Za-z0-9_]+\\\}/g, '[^/]+')}$`),
  }));
}

// Paths the docs mention on purpose that are not `/v1` REST routes.
const ROUTE_ALLOWLIST = [
  /^\/v1\/rtc$/, // signaling WebSocket, not an HTTP route
  /^\/v1\/chat\/ws$/, // chat WebSocket
];

function checkRoutes(files, gt) {
  const matchers = routeMatchers(gt.routes);
  // Routes appear three ways: bare (`POST /v1/rooms`), backticked (the
  // generated reference writes `POST \`/v1/rooms\``), and absolute in a curl
  // example. One pattern covers all three so no page is silently unchecked.
  const methodRe = /\b(GET|POST|PUT|PATCH|DELETE)\s+`?(?:https?:\/\/[^/\s`]+)?(\/v1\/[A-Za-z0-9_$%{}:./-]*)/g;

  for (const slug of files) {
    const text = readSlug(slug);
    for (const m of text.matchAll(methodRe)) {
      const method = m[1];
      const raw = m[2].replace(/[.,)]+$/, '');
      if (ROUTE_ALLOWLIST.some((re) => re.test(raw))) continue;

      const hit = matchers.find((x) => x.re.test(raw));
      if (!hit) {
        fail('routes', slug, `${method} ${raw} — no such route in apps/api`);
        continue;
      }
      if (hit.route.method !== method) {
        const alt = matchers.filter((x) => x.re.test(raw)).map((x) => x.route.method);
        if (!alt.includes(method)) {
          fail('routes', slug, `${method} ${raw} — route exists but only as ${alt.join('/')}`);
          continue;
        }
      }
      bump('routes');
    }
  }
}

// Env vars the docs name that the API does not read, with why.
const ENV_ALLOWLIST = new Set([
  // Shell placeholders in copyable examples — the reader substitutes a real
  // id. Named here rather than reworded in the docs, because `$WEBHOOK_ID` is
  // more obviously a placeholder than a literal uuid would be.
  'WEBHOOK_ID',
  'PROJECT_ID',
  'ROOM_ID',
  'STREAM_ID',
  'RAVEN_API_KEY', // read by the developer's own backend, not by Livqeno
  'RAVEN_WEBHOOK_SECRET', // ditto: where they keep the signing secret Livqeno issued
  'RAVEN_API_URL', // read by the CLI
  'RAVEN_TOKEN', // read by the CLI
  'NEXT_PUBLIC_DOCS_URL', // read by apps/docs
  'DATABASE_URL',
  'DIRECT_URL',
]);

// ---------------------------------------------------------------------------
// 2. Error codes
// ---------------------------------------------------------------------------

// Codes that legitimately appear in the docs without being API error codes.
const ERROR_CODE_ALLOWLIST = new Set([
  // Raised by the server SDKs before a request leaves the process, so they
  // never appear in an HTTP body. Documented as such on the errors page.
  'RAVEN_TIMEOUT',
  'RAVEN_NETWORK_ERROR',
  'RAVEN_INVALID_CONFIG',
  'RAVEN_UNKNOWN_ERROR',
]);

function checkErrorCodes(files, gt) {
  const known = new Set(gt.vocabularies.ravenErrorCodes.map((c) => c.value));
  const effects = new Set(gt.vocabularies.sdkErrorCodes['@ravenkash/effects'] ?? []);

  for (const slug of files) {
    const text = readSlug(slug);
    for (const m of text.matchAll(/\bRAVEN_[A-Z0-9_]+\b/g)) {
      const code = m[0];
      if (known.has(code) || effects.has(code) || ERROR_CODE_ALLOWLIST.has(code)) {
        bump('errorCodes');
        continue;
      }
      // Env vars share the prefix; they are checked separately.
      if (gt.config.readByAnyComponent.includes(code)) continue;
      // Developer-side env var names, checked by checkEnvVars instead.
      if (ENV_ALLOWLIST.has(code)) continue;
      fail('errorCodes', slug, `${code} — not in RavenErrorCode, EffectsErrorCode, or the SDK-local set`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Package imports
// ---------------------------------------------------------------------------

function packageSymbols(gt) {
  const map = new Map();
  for (const pkg of gt.packages) {
    for (const [entry, data] of Object.entries(pkg.entries)) {
      const specifier = entry === 'index' ? pkg.name : `${pkg.name}/${entry}`;
      map.set(specifier, new Set([...data.values, ...data.types]));
    }
  }
  return map;
}

function checkTsImports(files, gt) {
  const symbols = packageSymbols(gt);

  for (const slug of files) {
    for (const block of codeBlocks(readSlug(slug))) {
      if (!['ts', 'tsx', 'js', 'jsx'].includes(block.lang)) continue;

      for (const m of block.body.matchAll(
        /import\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*'(@ravenkash\/[a-z-]+(?:\/[a-z]+)?)'/g,
      )) {
        const specifier = m[2];
        const known = symbols.get(specifier);
        if (!known) {
          fail('imports', slug, `imports from '${specifier}', which is not a Livqeno package entry point`);
          continue;
        }
        for (const raw of m[1].split(',')) {
          const piece = raw.trim().replace(/^type\s+/, '');
          if (!piece) continue;
          const name = piece.split(/\s+as\s+/)[0].trim();
          if (!name) continue;
          if (!known.has(name)) {
            fail('imports', slug, `'${name}' is not exported by ${specifier}`);
            continue;
          }
          bump('imports');
        }
      }
    }
  }
}

function checkPythonImports(files, gt) {
  const known = new Set(gt.python.exports);
  for (const slug of files) {
    for (const block of codeBlocks(readSlug(slug))) {
      if (block.lang !== 'python' && block.lang !== 'py') continue;
      for (const m of block.body.matchAll(/^from raven import ([^\n]+)$/gm)) {
        for (const raw of m[1].split(',')) {
          const name = raw.trim().replace(/\\$/, '');
          if (!name) continue;
          if (!known.has(name)) {
            fail('imports', slug, `'${name}' is not in raven-sdk's __all__`);
            continue;
          }
          bump('imports');
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. CLI commands
// ---------------------------------------------------------------------------

function cliVocabulary(gt) {
  const words = new Set(['raven']);
  for (const group of Object.values(gt.cli.byFile)) {
    for (const cmd of [...group.commands, ...group.aliases]) {
      // `create <name>` → `create`
      words.add(cmd.split(/\s+/)[0]);
    }
  }
  return words;
}

// Flags and words that follow a command but are not commands themselves.
const CLI_NOISE = /^(-{1,2}|<|\$|"|')/;

function checkCliCommands(files, gt) {
  const known = cliVocabulary(gt);

  for (const slug of files) {
    for (const block of codeBlocks(readSlug(slug))) {
      if (!['bash', 'sh', 'shell', 'console', 'yaml'].includes(block.lang)) continue;
      for (const line of block.body.split('\n')) {
        const m = line.match(/(?:^|\s|\$\s*)raven\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?/);
        if (!m) continue;
        const [, first, second] = m;
        if (!known.has(first)) {
          fail('cli', slug, `\`raven ${first}\` — no such command`);
          continue;
        }
        if (second && !CLI_NOISE.test(second) && !known.has(second)) {
          // A subcommand of a group we do know about. Only flag it when the
          // parent is a group, since `raven login --token` is fine.
          const isGroup = Object.values(gt.cli.byFile).some((g) => g.commands.includes(first) && g.commands.length > 1);
          if (isGroup) fail('cli', slug, `\`raven ${first} ${second}\` — no such subcommand`);
          continue;
        }
        bump('cli');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Environment variables
// ---------------------------------------------------------------------------

function envVocabulary(gt) {
  const known = new Set([...gt.config.readByAnyComponent, ...gt.config.inEnvExample, ...ENV_ALLOWLIST]);
  // Several vocabularies are SCREAMING_SNAKE and share a prefix with the env
  // names — `SIGNALING_ERROR` is an RTC error category, `RATE_LIMITED` a chat
  // frame code. They are legitimate; taking them from the same artifact means
  // adding one to the code adds it here too.
  for (const values of Object.values(gt.prisma.enums)) for (const v of values) known.add(v);
  for (const group of [gt.vocabularies.signaling, gt.vocabularies.chat]) {
    for (const member of group.errorCodes ?? []) known.add(member.value);
  }
  for (const codes of Object.values(gt.vocabularies.sdkErrorCodes)) {
    for (const c of codes ?? []) known.add(c);
  }
  return known;
}

// Prefixes that mean "this is meant to be a Livqeno env var", so a typo in one
// is a finding rather than an unrelated SCREAMING_SNAKE word.
const ENV_PREFIX =
  /^(API|APP|CHAT|CORS|DATABASE|DIRECT|EMAIL|GITHUB|GOOGLE|JWT|LOG|OAUTH|OBSERVABILITY|PASSWORD|RATE_LIMIT|REDIS|RESEND|RTC|SFU|SIGNALING|STORAGE|TURN|WEBHOOK|DOCS)_/;

function checkEnvVars(files, gt) {
  const known = envVocabulary(gt);
  for (const slug of files) {
    const text = readSlug(slug);
    for (const m of text.matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g)) {
      const name = m[1];
      if (!ENV_PREFIX.test(name)) continue;
      if (known.has(name)) {
        bump('envVars');
        continue;
      }
      fail('envVars', slug, `${name} — looks like a Livqeno env var but nothing reads it`);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Links and anchors
// ---------------------------------------------------------------------------

/**
 * `github-slugger`'s algorithm, which is what `rehype-slug` uses to mint the
 * ids the site actually renders.
 *
 * Reimplemented rather than imported so this script stays dependency-free,
 * and the one subtlety worth stating is why: punctuation is *removed* before
 * spaces become hyphens, and each space becomes its own hyphen. So
 * "Authorization — two checks" is `authorization--two-checks`, with two
 * hyphens where the em-dash used to be between two spaces. Collapsing
 * whitespace first — the obvious implementation — produces a single hyphen
 * and reports every correct link on a page with a dash in a heading as
 * broken. `test/slug.spec.ts` pins the cases.
 */
export function headingSlug(text, seen) {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\- ]/g, '')
    .replace(/ /g, '-');

  if (!seen) return base;
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

function headingSlugs(text) {
  const ids = new Set();
  const seen = new Map();
  for (const m of text.matchAll(/^#{2,6}\s+(.+)$/gm)) {
    ids.add(headingSlug(m[1], seen));
  }
  return ids;
}

function checkLinks(files) {
  const known = new Set(files);
  const anchorsBySlug = new Map(files.map((s) => [s, headingSlugs(readSlug(s))]));

  for (const slug of files) {
    const text = readSlug(slug);
    for (const m of text.matchAll(/\]\((\/[A-Za-z0-9/._#-]*)\)/g)) {
      const [target, anchor] = m[1].slice(1).split('#');
      const page = target === '' ? '' : target;

      if (page !== '' && !known.has(page)) {
        fail('links', slug, `link to /${target} — no such content page`);
        continue;
      }
      if (anchor) {
        const anchors = anchorsBySlug.get(page);
        if (anchors && !anchors.has(anchor)) {
          fail('links', slug, `link to /${target}#${anchor} — no such heading on that page`);
          continue;
        }
      }
      bump('links');
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Redirects
//
// A redirect is invisible to every other check here: it lives in
// next.config.ts, not in Markdown, so the link checker and the nav check
// both pass while the deployed site sends readers to a 404.
//
// Two ways it goes wrong, and both had actually happened:
//
//   - `source` is also a live page. The redirect wins, so the page becomes
//     unreachable. `/sdk/cli` → `/cli` did this the moment the CLI page moved
//     into the SDKs section: the live path redirected to the dead one.
//   - `destination` is not a page. `/server/rest-api` → `/api-reference`
//     did this once `/api-reference` was replaced by the generated `/api` set.
// ---------------------------------------------------------------------------

function checkRedirects(files) {
  const config = fs.readFileSync(path.join(ROOT, 'apps/docs/next.config.ts'), 'utf8');
  const redirects = [...config.matchAll(/\{\s*source:\s*'([^']+)'\s*,\s*destination:\s*'([^']+)'/g)].map((m) => ({
    source: m[1],
    destination: m[2],
  }));

  if (!redirects.length) {
    fail('redirects', 'next.config.ts', 'no redirects parsed — has the config shape changed?');
    return;
  }

  const pages = new Set(files);
  const sources = new Set(redirects.map((r) => r.source));

  for (const { source, destination } of redirects) {
    const sourceSlug = source.replace(/^\//, '');
    if (pages.has(sourceSlug)) {
      fail(
        'redirects',
        'next.config.ts',
        `'${source}' is a redirect source AND a real page — the redirect shadows it, making the page unreachable`,
      );
      continue;
    }

    // Only internal destinations are ours to resolve.
    if (!destination.startsWith('/')) {
      bump('redirects');
      continue;
    }
    const destSlug = destination.replace(/^\//, '');
    if (!pages.has(destSlug) && !sources.has(destination)) {
      fail('redirects', 'next.config.ts', `'${source}' redirects to '${destination}', which is not a page`);
      continue;
    }
    bump('redirects');
  }
}

// ---------------------------------------------------------------------------
// 7. Nav parity
// ---------------------------------------------------------------------------

function checkNav(files) {
  const navSource = fs.readFileSync(path.join(ROOT, 'apps/docs/src/lib/nav.ts'), 'utf8');
  const navBody = navSource.slice(navSource.indexOf('export const NAV'));
  const navSlugs = [...navBody.matchAll(/slug:\s*'([^']+)'/g)].map((m) => m[1]);
  const known = new Set(files);

  for (const slug of navSlugs) {
    if (!known.has(slug)) fail('nav', 'src/lib/nav.ts', `sidebar points at '${slug}', which has no content file`);
    else bump('nav');
  }

  const inNav = new Set(navSlugs);
  for (const slug of files) {
    if (!inNav.has(slug)) fail('nav', `${slug}.md`, 'page exists but is not reachable from the sidebar');
  }
}

// ---------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(GROUNDTRUTH)) {
    process.stderr.write('groundtruth.json missing — run: node scripts/docs-groundtruth.mjs\n');
    process.exit(2);
  }
  const gt = JSON.parse(fs.readFileSync(GROUNDTRUTH, 'utf8'));
  const files = contentFiles();

  checkRoutes(files, gt);
  checkErrorCodes(files, gt);
  checkTsImports(files, gt);
  checkPythonImports(files, gt);
  checkCliCommands(files, gt);
  checkEnvVars(files, gt);
  checkLinks(files);
  checkRedirects(files);
  checkNav(files);

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ counts, failures }, null, 2)}\n`);
  } else {
    process.stdout.write(`Verified ${files.length} pages\n`);
    for (const [check, n] of Object.entries(counts).sort()) {
      process.stdout.write(`  ${check.padEnd(12)} ${n} claim(s) checked\n`);
    }
    if (failures.length) {
      process.stdout.write(`\n${failures.length} failure(s):\n\n`);
      const byCheck = {};
      for (const f of failures) (byCheck[f.check] ??= []).push(f);
      for (const [check, list] of Object.entries(byCheck)) {
        process.stdout.write(`[${check}]\n`);
        for (const f of list) process.stdout.write(`  ${f.file}: ${f.message}\n`);
        process.stdout.write('\n');
      }
    } else {
      process.stdout.write('\nNo drift found.\n');
    }
  }

  process.exit(failures.length ? 1 : 0);
}

if (process.argv[1] && process.argv[1].endsWith('verify-docs.mjs')) main();
