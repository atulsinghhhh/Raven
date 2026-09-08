#!/usr/bin/env node
// Extracts Raven's public surface from source into one JSON artifact.
//
// Two things consume it:
//
//   - scripts/generate-api-reference.mjs, which writes the REST reference
//     pages, so the reference cannot drift from the controllers.
//   - scripts/verify-docs.mjs, which fails the build when the prose
//     documents a route, error code, CLI command or SDK symbol that no
//     longer exists.
//
// Deliberately regex-based rather than a TypeScript AST walk. The inputs are
// Nest decorators and `export {}` barrels, both of which are written to a
// house style this file encodes; a full compiler pass would cost a dependency
// and a build step to read the same handful of string literals. Anything this
// cannot parse confidently is reported in `warnings` instead of guessed at, so
// a shape it does not understand shows up as a gap rather than as silence.
//
//   node scripts/docs-groundtruth.mjs [--out <path>]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const warnings = [];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function walk(rel, filter) {
  const out = [];
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const childRel = path.posix.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...walk(childRel, filter));
    else if (filter(entry.name)) out.push(childRel);
  }
  return out;
}

// ---------------------------------------------------------------------------
// REST routes
// ---------------------------------------------------------------------------

const GUARD_CREDENTIAL = {
  JwtAuthGuard: 'session',
  ApiKeyAuthGuard: 'apiKey',
  ChatAuthGuard: 'apiKey|chatToken',
  TelemetryIngestGuard: 'rtcToken',
  SfuRegistrationGuard: 'sfuSecret',
  RateLimitGuard: null, // not a credential
};

/** `@Controller('v1/rooms')` → `v1/rooms`. */
function controllerPrefix(source) {
  const m = source.match(/@Controller\(\s*'([^']*)'\s*\)/);
  return m ? m[1] : undefined;
}

function guardsIn(text) {
  const names = [];
  for (const m of text.matchAll(/@UseGuards\(([^)]*)\)/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

/** Everything above the first `@Controller`/`export class` line: the class-level decorators. */
function classHeader(source) {
  const idx = source.search(/@Controller\(/);
  if (idx === -1) return '';
  const classIdx = source.indexOf('export class', idx);
  return source.slice(idx, classIdx === -1 ? source.length : classIdx);
}

function credentialFor(guardNames) {
  const creds = guardNames.map((g) => GUARD_CREDENTIAL[g]).filter((c) => c !== null && c !== undefined);
  return creds.length ? [...new Set(creds)].join('|') : 'none';
}

function joinPath(prefix, sub) {
  const parts = [prefix, sub].filter((p) => p !== undefined && p !== '');
  return '/' + parts.join('/').replace(/\/+/g, '/').replace(/^\//, '');
}

/** `:projectId` → `{projectId}`, so the docs read like the REST reference rather than like Nest. */
function toDocPath(p) {
  return p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function firstString(text, key) {
  const m = text.match(new RegExp(`${key}:\\s*'((?:[^'\\\\]|\\\\.)*)'`));
  if (m) return m[1].replace(/\\'/g, "'");
  const dq = text.match(new RegExp(`${key}:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  return dq ? dq[1].replace(/\\"/g, '"') : undefined;
}

function extractRoutes() {
  const routes = [];
  const files = walk('apps/api/src', (n) => n.endsWith('.controller.ts') && !n.endsWith('.spec.ts'));

  for (const file of files) {
    const source = read(file);
    const prefix = controllerPrefix(source);
    if (prefix === undefined) {
      warnings.push(`${file}: has no @Controller('...') literal; skipped`);
      continue;
    }

    const header = classHeader(source);
    const classGuards = guardsIn(header);
    const tag = firstString(header, 'ApiTags') ?? header.match(/@ApiTags\('([^']+)'\)/)?.[1];

    // Split the class body on method-level HTTP decorators. Each chunk holds
    // one route's decorators plus its signature; the decorators that matter
    // (@ApiOperation, @UseGuards, @RateLimit) all sit inside it.
    const bodyIdx = source.indexOf('export class');
    const body = bodyIdx === -1 ? source : source.slice(bodyIdx);
    const httpDecorator = /@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?\s*\)/g;

    const matches = [...body.matchAll(httpDecorator)];
    for (let i = 0; i < matches.length; i += 1) {
      const m = matches[i];
      const chunk = body.slice(m.index, matches[i + 1]?.index ?? body.length);
      const method = m[1].toUpperCase();
      const sub = m[2] ?? '';

      const methodGuards = guardsIn(chunk);
      const rateLimit = chunk.match(/@RateLimit\((\d+)\)/)?.[1];
      const handler = chunk.match(/\n\s{2}(?:async\s+)?([A-Za-z0-9_]+)\s*\(/)?.[1];
      const bodyDto = chunk.match(/@Body\(\)\s*[a-zA-Z]+:\s*([A-Za-z]+Dto)/)?.[1];
      const queryDto = chunk.match(/@Query\(\)\s*[a-zA-Z]+:\s*([A-Za-z]+Dto)/)?.[1];

      routes.push({
        method,
        path: toDocPath(joinPath(prefix, sub)),
        nestPath: joinPath(prefix, sub),
        file,
        handler,
        tag,
        guards: [...classGuards, ...methodGuards],
        credential: credentialFor([...classGuards, ...methodGuards]),
        rateLimitPerWindow: rateLimit ? Number(rateLimit) : undefined,
        summary: firstString(chunk, 'summary'),
        idempotent: /@Idempotent\(/.test(chunk),
        pathParams: [...(sub.matchAll(/:([A-Za-z0-9_]+)/g) ?? [])]
          .map((x) => x[1])
          .concat([...prefix.matchAll(/:([A-Za-z0-9_]+)/g)].map((x) => x[1])),
        bodyDto,
        queryDto,
      });
    }
  }

  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return routes;
}

/**
 * Request DTOs, field by field, from their `class-validator` decorators.
 *
 * This is what makes the generated reference worth reading rather than a route
 * list: `ttlSeconds` is documented as "integer, 30–21600, optional" because
 * `@IsInt() @Min(30) @Max(21600) @IsOptional()` says so, not because someone
 * transcribed it. `required` is the negation of `@IsOptional()`, which is how
 * Nest's ValidationPipe actually decides.
 */
function extractDtos() {
  const dtos = {};
  for (const file of walk('apps/api/src', (n) => n.endsWith('.dto.ts'))) {
    const source = read(file);
    for (const cls of source.matchAll(/export class ([A-Za-z]+Dto)\s*\{([\s\S]*?)\n\}/g)) {
      const [, name, classBody] = cls;
      const fields = [];

      // Each field is its decorator stack plus one `name!: type` / `name?: type`
      // declaration. Splitting on the declaration keeps them together.
      const declRe = /^\s{2}([a-zA-Z][A-Za-z0-9_]*)([?!])?:\s*([^;=]+?)(?:\s*=\s*([^;]+))?;/gm;
      let cursor = 0;
      for (const decl of classBody.matchAll(declRe)) {
        const decorators = classBody.slice(cursor, decl.index);
        cursor = decl.index + decl[0].length;

        const [, fieldName, marker, rawType, defaultValue] = decl;
        const optional = marker === '?' || /@IsOptional\(\)/.test(decorators);

        fields.push({
          name: fieldName,
          type: rawType.trim(),
          required: !optional,
          default: defaultValue?.trim(),
          min: decorators.match(/@Min\((-?[\d_]+)/)?.[1],
          max: decorators.match(/@Max\((-?[\d_]+)/)?.[1],
          minLength: decorators.match(/@MinLength\((\d+)/)?.[1],
          maxLength: decorators.match(/@MaxLength\((\d+)/)?.[1],
          pattern: decorators.match(/@Matches\(([A-Za-z_]+|\/[^,)]+)/)?.[1],
          enum: [...decorators.matchAll(/@IsIn\(\[([^\]]*)\]/g)]
            .flatMap((m) => [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]))
            .filter(Boolean),
          isArray: /@IsArray\(\)/.test(decorators),
          description: firstString(decorators, 'description'),
          example: firstString(decorators, 'example'),
        });
      }

      dtos[name] = { file, fields };
    }
  }
  return dtos;
}

// ---------------------------------------------------------------------------
// Package exports
// ---------------------------------------------------------------------------

const PACKAGES = [
  { dir: 'packages/sdk', name: '@corvidhq/rtc' },
  { dir: 'packages/chat-sdk', name: '@corvidhq/chat' },
  { dir: 'packages/client', name: '@corvidhq/client' },
  { dir: 'packages/effects', name: '@corvidhq/effects' },
  { dir: 'packages/react-sdk', name: '@corvidhq/react', entries: ['index', 'chat'] },
  { dir: 'packages/react-native-sdk', name: '@corvidhq/react-native' },
  { dir: 'packages/server-sdk', name: '@corvidhq/server' },
  { dir: 'packages/cli', name: '@corvidhq/cli' },
];

/**
 * Symbols a package's barrel re-exports.
 *
 * Prefers the built `.d.ts`, which is what a consumer's editor actually
 * resolves. Falls back to the barrel source when a package has not been
 * built, and says which one it used so a stale `dist/` cannot masquerade as
 * ground truth.
 */
function extractExports(pkg) {
  const entries = pkg.entries ?? ['index'];
  const result = {};

  for (const entry of entries) {
    const dts = `${pkg.dir}/dist/${entry}.d.ts`;
    const src = `${pkg.dir}/src/${entry}.ts`;
    const from = exists(dts) ? dts : exists(src) ? src : undefined;
    if (!from) {
      warnings.push(`${pkg.name}: no ${dts} or ${src}; exports unknown`);
      continue;
    }

    const text = read(from);
    const values = new Set();
    const types = new Set();

    // `export { a, b as c }` / `export type { X }`
    for (const m of text.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) {
      const isType = Boolean(m[1]);
      for (const raw of m[2].split(',')) {
        const piece = raw.trim();
        if (!piece) continue;
        const localType = piece.startsWith('type ');
        const cleaned = localType ? piece.slice(5).trim() : piece;
        const name = (cleaned.split(/\s+as\s+/).pop() ?? cleaned).trim();
        if (!name || name === 'default') continue;
        (isType || localType ? types : values).add(name);
      }
    }

    // `.d.ts` inlines declarations rather than re-exporting them.
    for (const m of text.matchAll(/^declare\s+(?:const|function|class)\s+([A-Za-z0-9_$]+)/gm)) values.add(m[1]);
    for (const m of text.matchAll(/^(?:declare\s+)?(?:type|interface)\s+([A-Za-z0-9_$]+)/gm)) types.add(m[1]);
    for (const m of text.matchAll(/^export\s+(?:declare\s+)?(?:const|function|class)\s+([A-Za-z0-9_$]+)/gm))
      values.add(m[1]);
    for (const m of text.matchAll(/^export\s+(?:declare\s+)?(?:type|interface)\s+([A-Za-z0-9_$]+)/gm)) types.add(m[1]);

    result[entry] = {
      source: from,
      builtFromDts: from === dts,
      values: [...values].sort(),
      types: [...types].sort(),
    };
  }

  const pkgJson = JSON.parse(read(`${pkg.dir}/package.json`));
  return {
    name: pkg.name,
    dir: pkg.dir,
    version: pkgJson.version,
    private: Boolean(pkgJson.private),
    bin: pkgJson.bin,
    peerDependencies: pkgJson.peerDependencies,
    entries: result,
  };
}

/** `raven-sdk`'s public surface, straight off `__all__`. */
function extractPython() {
  const init = read('sdks/python/src/raven/__init__.py');
  const all = init.match(/__all__ = \[([\s\S]*?)\]/)?.[1];
  if (!all) warnings.push('sdks/python: no __all__ found in raven/__init__.py');

  const resourceMethods = {};
  for (const file of walk('sdks/python/src/raven/resources', (n) => n.endsWith('.py'))) {
    const source = read(file);
    for (const m of source.matchAll(/^class (Async)?([A-Za-z]+)Resource:/gm)) {
      const cls = `${m[1] ?? ''}${m[2]}Resource`;
      const body = source.slice(m.index).split(/\nclass /)[0];
      resourceMethods[cls] = [...body.matchAll(/^\s{4}(?:async )?def ([a-z_][a-z0-9_]*)\(/gm)]
        .map((x) => x[1])
        .filter((n) => !n.startsWith('_'));
    }
  }

  const pyproject = read('sdks/python/pyproject.toml');
  return {
    distribution: pyproject.match(/^name = "([^"]+)"/m)?.[1],
    importName: 'raven',
    version: pyproject.match(/^version = "([^"]+)"/m)?.[1],
    requiresPython: pyproject.match(/^requires-python = "([^"]+)"/m)?.[1],
    exports: all ? [...all.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort() : [],
    resourceMethods,
    clientAttributes: [...read('sdks/python/src/raven/client.py').matchAll(/^\s{8}self\.([a-z_]+) = /gm)].map(
      (m) => m[1],
    ),
  };
}

/** The three Dart packages and what each `library` barrel actually shows. */
function extractDart() {
  const packages = ['raven_rtc', 'raven_chat', 'raven_live'];
  return packages.map((name) => {
    const barrel = read(`sdks/flutter/${name}/lib/${name}.dart`);
    const pubspec = read(`sdks/flutter/${name}/pubspec.yaml`);
    const shown = new Set();
    for (const m of barrel.matchAll(/export\s+'[^']+'\s*(?:show\s+([\s\S]*?))?;/g)) {
      if (!m[1]) continue;
      for (const raw of m[1].split(',')) {
        const sym = raw.trim();
        if (sym) shown.add(sym);
      }
    }
    const members = {};
    for (const file of walk(`sdks/flutter/${name}/lib/src`, (n) => n.endsWith('.dart'))) {
      const source = read(file);
      for (const m of source.matchAll(/^class ([A-Za-z]+)/gm)) {
        const body = source.slice(m.index).split(/\nclass /)[0];
        members[m[1]] = [
          ...[...body.matchAll(/^\s{2}(?:static\s+)?[A-Za-z<>,?\s]+\s+([a-z][A-Za-z0-9_]*)\(/gm)].map((x) => x[1]),
          ...[...body.matchAll(/^\s{2}[A-Za-z<>,?\s]+\s+get ([a-z][A-Za-z0-9_]*)/gm)].map((x) => x[1]),
        ].filter((n) => !n.startsWith('_'));
      }
    }
    return {
      name,
      version: pubspec.match(/^version: (.+)$/m)?.[1].trim(),
      exports: [...shown].sort(),
      members,
    };
  });
}

// ---------------------------------------------------------------------------
// Enum-ish vocabularies
// ---------------------------------------------------------------------------

/** Members of a `export enum Name {}` block. */
function enumMembers(source, name) {
  const re = new RegExp(`export enum ${name}\\s*\\{([\\s\\S]*?)\\n\\}`);
  const m = source.match(re);
  if (!m) return undefined;
  const out = [];
  for (const line of m[1].matchAll(/^\s{2}([A-Z0-9_]+)\s*=\s*'([^']*)'/gm)) {
    out.push({ key: line[1], value: line[2] });
  }
  return out;
}

/** Members of a `export const Name = { KEY: 'value' } as const` block. */
function constMapMembers(source, name) {
  const re = new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\n\\} as const`);
  const m = source.match(re);
  if (!m) return undefined;
  const out = [];
  for (const line of m[1].matchAll(/^\s{2}([A-Z0-9_]+):\s*'([^']*)'/gm)) {
    out.push({ key: line[1], value: line[2] });
  }
  return out;
}

/**
 * A `export type X = | 'a' | 'b'` union of string literals.
 *
 * Comments are stripped first, and that is not cosmetic. `RTCErrorCode`
 * documents two of its members with a doc comment containing a semicolon, so
 * matching lazily up to the first `;` silently returned 11 of 13 codes — a
 * truncation with no error, which is the worst failure mode this file can
 * have. Strip comments, then the only semicolon left is the real terminator.
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function stringUnion(source, name) {
  const clean = stripComments(source);
  const re = new RegExp(`export type ${name} =([^;]*);`);
  const m = clean.match(re);
  if (!m) {
    warnings.push(`stringUnion: no "export type ${name} = ...;" found`);
    return undefined;
  }
  const values = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  if (!values.length) warnings.push(`stringUnion: ${name} matched but yielded no string literals`);
  return values;
}

/** Keys of a `export interface X {}` whose members are `name: (…) => void`. */
function eventMapKeys(source, name) {
  const re = new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`);
  const m = source.match(re);
  if (!m) return undefined;
  return [...m[1].matchAll(/^\s{2}([A-Za-z0-9_]+):\s*\(([^)]*)\)\s*=>/gm)].map((x) => ({
    event: x[1],
    args: x[2].trim(),
  }));
}

function extractVocabularies() {
  const apiErrors = read('apps/api/src/shared/errors/error-codes.ts');
  const signaling = read('apps/api/src/modules/signaling/signaling.constants.ts');
  const chatConst = read('apps/api/src/modules/chat/chat.constants.ts');
  const webhookEvents = read('apps/api/src/modules/webhooks/webhook-events.service.ts');

  const webhook = [
    ...(read('apps/api/src/modules/webhooks/webhook-events.service.ts')
      .match(/export const WEBHOOK_EVENT_TYPES = \[([\s\S]*?)\] as const/)?.[1]
      .matchAll(/'([^']+)'/g) ?? []),
  ].map((m) => m[1]);

  return {
    ravenErrorCodes: constMapMembers(apiErrors, 'RavenErrorCode'),
    legacyErrorCodeMapPresent: /export const LEGACY_ERROR_CODE/.test(apiErrors),
    signaling: {
      path: signaling.match(/export const SIGNALING_PATH = '([^']+)'/)?.[1],
      heartbeatIntervalMs: Number(signaling.match(/HEARTBEAT_INTERVAL_MS = ([\d_]+)/)?.[1].replace(/_/g, '')),
      heartbeatTimeoutMs: Number(signaling.match(/HEARTBEAT_TIMEOUT_MS = ([\d_]+)/)?.[1].replace(/_/g, '')),
      clientFrames: enumMembers(signaling, 'ClientMessageType'),
      serverFrames: enumMembers(signaling, 'ServerMessageType'),
      errorCodes: enumMembers(signaling, 'SignalingErrorCode'),
    },
    chat: {
      path: chatConst.match(/export const CHAT_PATH = '([^']+)'/)?.[1],
      heartbeatIntervalMs: Number(chatConst.match(/CHAT_HEARTBEAT_INTERVAL_MS = ([\d_]+)/)?.[1].replace(/_/g, '')),
      clientFrames: enumMembers(chatConst, 'ChatClientFrame'),
      serverFrames: enumMembers(chatConst, 'ChatServerFrame'),
      errorCodes: enumMembers(chatConst, 'ChatErrorCode'),
      presenceStatus: enumMembers(chatConst, 'PresenceStatus'),
      closeCodes: Object.fromEntries(
        [...chatConst.matchAll(/export const (CHAT_CLOSE_[A-Z_]+) = (\d+)/g)].map((m) => [m[1], Number(m[2])]),
      ),
    },
    webhookEventTypes: webhook,
    webhookEmitSites: [
      ...webhookEvents.matchAll(/'([^']+)'/g), // placeholder; real sites collected below
    ].length
      ? collectWebhookEmitSites()
      : [],
    sdkErrorCodes: {
      '@corvidhq/rtc': stringUnion(read('packages/sdk/src/errors.ts'), 'RTCErrorCode'),
      '@corvidhq/chat': stringUnion(read('packages/chat-sdk/src/errors.ts'), 'ChatErrorCode'),
      '@corvidhq/effects': stringUnion(read('packages/effects/src/errors.ts'), 'EffectsErrorCode'),
    },
    eventMaps: {
      RoomEventMap: eventMapKeys(read('packages/sdk/src/room.ts'), 'RoomEventMap'),
      ChatEventMap: eventMapKeys(read('packages/chat-sdk/src/client.ts'), 'ChatEventMap'),
    },
  };
}

/** Which webhook event names actually have an `emit(..., 'name', ...)` call. */
function collectWebhookEmitSites() {
  const sites = [];
  for (const file of walk('apps/api/src', (n) => n.endsWith('.ts') && !n.endsWith('.spec.ts'))) {
    const source = read(file);
    for (const m of source.matchAll(/emit\(\s*[A-Za-z0-9_.]+\s*,\s*'([a-z_]+\.[a-z_]+)'/g)) {
      sites.push({ event: m[1], file });
    }
  }
  return sites;
}

// ---------------------------------------------------------------------------
// CLI, config, effects, prisma
// ---------------------------------------------------------------------------

function extractCli() {
  const groups = {};
  for (const file of walk('packages/cli/src/commands', (n) => n.endsWith('.ts') && !n.endsWith('.spec.ts'))) {
    const source = read(file);
    const cmds = [...source.matchAll(/\.command\('([^']+)'\)/g)].map((m) => m[1]);
    const aliases = [...source.matchAll(/\.alias\('([^']+)'\)/g)].map((m) => m[1]);
    if (cmds.length || aliases.length) {
      groups[file.replace('packages/cli/src/commands/', '')] = { commands: cmds, aliases };
    }
  }
  const registered = [...read('packages/cli/src/cli.ts').matchAll(/register([A-Za-z]+)Command\(program\)/g)].map((m) =>
    m[1].replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
  );
  return { registeredGroups: registered, byFile: groups };
}

/**
 * Every environment variable any Raven component reads.
 *
 * Three sources, because a variable read by the SFU is no less real than one
 * read by the API — and the docs' env reference used to list only the API's,
 * which made every `SFU_*` key look like a typo.
 */
function extractConfig() {
  const api = new Set();
  for (const file of walk('apps/api/src', (n) => n.endsWith('.ts') && !n.endsWith('.spec.ts'))) {
    for (const m of read(file).matchAll(/process\.env\.([A-Z0-9_]+)/g)) api.add(m[1]);
  }

  // The SFU is Go and reads through os.Getenv plus two small helpers.
  const sfu = new Set();
  for (const file of walk('services/sfu', (n) => n.endsWith('.go') && !n.endsWith('_test.go'))) {
    for (const m of read(file).matchAll(/(?:os\.Getenv|envOr|envIntOr)\(\s*"([A-Z0-9_]+)"/g)) sfu.add(m[1]);
  }

  const dashboard = new Set();
  for (const file of walk('apps/dashboard/src', (n) => n.endsWith('.ts') || n.endsWith('.tsx'))) {
    for (const m of read(file).matchAll(/process\.env\.([A-Z0-9_]+)/g)) dashboard.add(m[1]);
  }

  const example = new Set([...read('.env.example').matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));
  const all = new Set([...api, ...sfu, ...dashboard]);

  return {
    readByApi: [...api].sort(),
    readBySfu: [...sfu].sort(),
    readByDashboard: [...dashboard].sort(),
    readByAnyComponent: [...all].sort(),
    inEnvExample: [...example].sort(),
    readButUndocumented: [...all].filter((k) => !example.has(k)).sort(),
  };
}

function extractEffects() {
  const index = read('packages/effects/src/filters/index.ts');
  const filterNames = [
    ...(index.match(/export const FILTER_DEFINITIONS[^=]*= \{([\s\S]*?)\n\}/)?.[1].matchAll(/^\s{2}([A-Za-z]+):/gm) ??
      []),
  ].map((m) => m[1]);

  const filters = filterNames.map((name) => {
    const candidates = [`packages/effects/src/filters/${name}.ts`, 'packages/effects/src/foundations/beauty.ts'];
    const file = candidates.find((c) => exists(c) && new RegExp(`type: '${name}'`).test(read(c)));
    if (!file) {
      warnings.push(`effects: no definition file found for filter "${name}"`);
      return { name };
    }
    const source = read(file);
    const params = [
      ...source.matchAll(/^\s{4}([a-zA-Z]+):\s*\{\s*min:\s*(-?[\d.]+),\s*max:\s*(-?[\d.]+),\s*default:\s*(-?[\d.]+)/gm),
    ].map((m) => ({ param: m[1], min: Number(m[2]), max: Number(m[3]), default: Number(m[4]) }));
    return {
      name,
      category: source.match(new RegExp(`type: '${name}',\\s*\\n\\s*category: '([a-z]+)'`))?.[1],
      params,
      file,
    };
  });

  const presets = read('packages/effects/src/presets.ts').match(/export const presets = \{([^}]*)\}/)?.[1];
  return {
    filters,
    presets: presets
      ? presets
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  };
}

function extractPrisma() {
  const schema = read('apps/api/prisma/schema.prisma');
  return {
    models: [...schema.matchAll(/^model ([A-Za-z]+) \{/gm)].map((m) => m[1]),
    enums: Object.fromEntries(
      [...schema.matchAll(/^enum ([A-Za-z]+) \{([\s\S]*?)\n\}/gm)].map((m) => [
        m[1],
        [...m[2].matchAll(/^\s+([A-Z0-9_]+)\s*$/gm)].map((x) => x[1]),
      ]),
    ),
  };
}

/** Ceilings and TTLs a developer hits in practice, read from configuration.ts defaults. */
function extractLimits() {
  const config = read('apps/api/src/shared/config/configuration.ts');
  const pick = (key) => {
    const m = config.match(
      new RegExp(`${key}:\\s*(?:parseInt\\()?process\\.env\\.([A-Z0-9_]+)\\s*\\?\\?\\s*(?:String\\()?'?([^',)]+)'?`),
    );
    if (!m) return undefined;
    return { env: m[1], default: m[2].trim() };
  };
  const names = [
    'maxParticipantsPerRoom',
    'maxMessageBytes',
    'maxMessagesPerWindow',
    'maxConnectionsPerWindow',
    'tokenDefaultTtlSeconds',
    'tokenMaxTtlSeconds',
    'maxTextLength',
    'maxMetadataBytes',
    'maxFrameBytes',
    'maxReactionsPerMessage',
    'maxRoomSubscriptionsPerConnection',
    'maxHistoryPageSize',
    'sendRateLimit',
    'presenceTtlSeconds',
    'typingTtlSeconds',
    'maxAttachmentBytes',
    'uploadUrlTtlSeconds',
    'downloadUrlTtlSeconds',
    'maxAttempts',
    'backoffBaseMs',
    'timeoutMs',
    'disableAfterConsecutiveFailures',
    'defaultTtlSeconds',
    'windowSeconds',
    'heartbeatTimeoutSeconds',
  ];
  return Object.fromEntries(names.map((n) => [n, pick(n)]).filter(([, v]) => v));
}

// ---------------------------------------------------------------------------

function main() {
  const outArg = process.argv.indexOf('--out');
  const out = outArg === -1 ? 'apps/docs/groundtruth.json' : process.argv[outArg + 1];

  const artifact = {
    generatedBy: 'scripts/docs-groundtruth.mjs',
    note: 'Generated from source. Do not hand-edit; run the script.',
    routes: extractRoutes(),
    dtos: extractDtos(),
    packages: PACKAGES.map(extractExports),
    vocabularies: extractVocabularies(),
    cli: extractCli(),
    python: extractPython(),
    dart: extractDart(),
    config: extractConfig(),
    effects: extractEffects(),
    prisma: extractPrisma(),
    limits: extractLimits(),
    warnings,
  };

  fs.writeFileSync(path.join(ROOT, out), `${JSON.stringify(artifact, null, 2)}\n`);

  const v = artifact.vocabularies;
  process.stdout.write(
    [
      `routes            ${artifact.routes.length}`,
      `packages          ${artifact.packages.length}`,
      `raven error codes ${v.ravenErrorCodes?.length ?? 0}`,
      `signaling frames  ${(v.signaling.clientFrames?.length ?? 0) + (v.signaling.serverFrames?.length ?? 0)}`,
      `chat frames       ${(v.chat.clientFrames?.length ?? 0) + (v.chat.serverFrames?.length ?? 0)}`,
      `webhook events    ${v.webhookEventTypes.length}`,
      `effects filters   ${artifact.effects.filters.length}`,
      `env keys read     ${artifact.config.readByApi.length}`,
      `warnings          ${warnings.length}`,
      `→ ${out}`,
      '',
    ].join('\n'),
  );

  for (const w of warnings) process.stderr.write(`warn: ${w}\n`);
}

main();
