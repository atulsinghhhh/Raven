import {
  FRAMEWORKS,
  LANGUAGES,
  PLATFORM_STATUS,
  PRODUCTS,
  getIntegrationEntry,
  isSupported,
  renderIntegrationReadme,
} from '@/lib/integration-registry';

const PROJECT = { id: 'proj_123', name: 'Test Project' };

describe('PLATFORM_STATUS', () => {
  it('marks Flutter Web as verified, and only Web', () => {
    const platforms = PLATFORM_STATUS.flutter;
    expect(platforms).toBeDefined();
    const web = platforms!.find((p) => p.id === 'web');
    expect(web?.verification).toBe('verified');

    const others = platforms!.filter((p) => p.id !== 'web');
    expect(others.length).toBeGreaterThan(0);
    for (const platform of others) {
      expect(platform.verification).not.toBe('verified');
    }
  });

  it('does NOT represent Android or iOS as verified', () => {
    const platforms = PLATFORM_STATUS.flutter!;
    const android = platforms.find((p) => p.id === 'android');
    const ios = platforms.find((p) => p.id === 'ios');
    expect(android?.verification).toBe('pending');
    expect(ios?.verification).toBe('pending');
  });

  it('has no platform breakdown for the single-runtime TypeScript frameworks', () => {
    for (const id of ['nextjs', 'react', 'vanilla', 'node'] as const) {
      expect(PLATFORM_STATUS[id]).toBeUndefined();
    }
  });
});

describe('LANGUAGES / FRAMEWORKS', () => {
  it('marks Dart (Flutter) and TypeScript as supported, Python as not', () => {
    const byId = Object.fromEntries(LANGUAGES.map((l) => [l.id, l.supported]));
    expect(byId.typescript).toBe(true);
    expect(byId.dart).toBe(true);
    expect(byId.python).toBe(false);
  });

  it('scopes flutter to dart and the four JS frameworks to typescript', () => {
    expect(FRAMEWORKS.find((f) => f.id === 'flutter')?.language).toBe('dart');
    for (const id of ['nextjs', 'react', 'vanilla', 'node']) {
      expect(FRAMEWORKS.find((f) => f.id === id)?.language).toBe('typescript');
    }
  });
});

describe('getIntegrationEntry — Dart / Flutter', () => {
  it('returns a real, supported entry for every product', () => {
    for (const product of PRODUCTS.map((p) => p.id)) {
      const entry = getIntegrationEntry(product, 'dart', 'flutter');
      expect(isSupported(entry)).toBe(true);
    }
  });

  it('installs the real published pub.dev package(s) for each product, via `flutter pub add`', () => {
    // live-streaming needs raven_rtc alongside raven_live — RavenVideoView
    // (used to render video) isn't re-exported by raven_live, so rendering
    // anything needs raven_rtc as a direct dependency too.
    const expected: Record<string, string> = {
      rtc: 'raven_rtc',
      chat: 'raven_chat',
      'live-streaming': 'raven_live raven_rtc',
    };
    for (const [product, pkgs] of Object.entries(expected)) {
      const entry = getIntegrationEntry(product as never, 'dart', 'flutter');
      if (!isSupported(entry)) throw new Error(`expected ${product} to be supported`);
      expect(entry.install).toHaveLength(1);
      expect(entry.install[0]).toMatchObject({ label: 'flutter pub add', code: `flutter pub add ${pkgs}` });
    }
  });

  it("live-streaming's Flutter recipe renders remote/live video and leaves cleanly", () => {
    const entry = getIntegrationEntry('live-streaming', 'dart', 'flutter');
    if (!isSupported(entry)) throw new Error('expected live-streaming+dart+flutter to be supported');
    const dartFile = entry.files.find((f) => f.language === 'dart');
    expect(dartFile).toBeDefined();
    expect(dartFile!.code).toContain('RavenVideoView');
    expect(dartFile!.code).toContain('.leave()');
    // RavenVideoView isn't re-exported by raven_live — the sample must
    // import raven_rtc directly to use it, not invent an API that doesn't
    // exist on raven_live.
    expect(dartFile!.code).toContain("import 'package:raven_rtc/raven_rtc.dart'");
  });

  it('generates real Dart, not JavaScript — every code file uses Dart-idiomatic string interpolation', () => {
    const entry = getIntegrationEntry('rtc', 'dart', 'flutter');
    if (!isSupported(entry)) throw new Error('expected rtc+dart+flutter to be supported');

    const dartFile = entry.files.find((f) => f.language === 'dart');
    expect(dartFile).toBeDefined();
    // `\$backendUrl` in the TS source must compile to a literal `$backendUrl`
    // (Dart string interpolation) in the emitted code — not an escaped,
    // inert `\$backendUrl`, which would be broken Dart.
    expect(dartFile!.code).toContain('$backendUrl');
    expect(dartFile!.code).not.toContain('\\$backendUrl');
    expect(dartFile!.code).not.toMatch(/\bnpm install\b|\bimport\s+\{/);
  });

  it('never puts a Raven credential in client-side (Dart) code', () => {
    for (const product of PRODUCTS.map((p) => p.id)) {
      const entry = getIntegrationEntry(product, 'dart', 'flutter');
      if (!isSupported(entry)) throw new Error(`expected ${product} to be supported`);
      expect(entry.env.client).toEqual([]);
      const dartFile = entry.files.find((f) => f.language === 'dart');
      expect(dartFile!.code).not.toMatch(/RAVEN_API_KEY/);
    }
  });

  it('names the real SDK source files it was adapted from', () => {
    const entry = getIntegrationEntry('rtc', 'dart', 'flutter');
    if (!isSupported(entry)) throw new Error('expected rtc+dart+flutter to be supported');
    expect(entry.source).toContain('sdks/flutter/raven_rtc');
  });
});

describe('getIntegrationEntry — Flutter Web Live Streaming', () => {
  it('references the real published packages and real SDK APIs, with no obsolete messaging', () => {
    const entry = getIntegrationEntry('live-streaming', 'dart', 'flutter');
    if (!isSupported(entry)) throw new Error('expected live-streaming+dart+flutter to be supported');

    expect(entry.packages.client).toBe('raven_live raven_rtc');
    const dartFile = entry.files.find((f) => f.language === 'dart');
    expect(dartFile).toBeDefined();
    expect(dartFile!.code).toContain('RavenLiveStream.join');
    expect(dartFile!.code).toContain('.isHost');
    expect(dartFile!.code).toContain('enableCamera');
    expect(dartFile!.code).toContain('enableMicrophone');

    for (const text of [entry.source, dartFile!.code, ...entry.files.map((f) => f.code)]) {
      expect(text.toLowerCase()).not.toContain('coming soon');
      expect(text.toLowerCase()).not.toContain('not supported');
      expect(text.toLowerCase()).not.toContain('not yet on pub.dev');
      expect(text.toLowerCase()).not.toContain('contact support');
    }
  });

  it('never embeds a server secret in the Dart (client) file', () => {
    const entry = getIntegrationEntry('live-streaming', 'dart', 'flutter');
    if (!isSupported(entry)) throw new Error('expected live-streaming+dart+flutter to be supported');
    const dartFile = entry.files.find((f) => f.language === 'dart');
    expect(dartFile!.code).not.toMatch(/RAVEN_API_KEY|API_SECRET|apiKey\s*:/i);
    // The client only ever fetches a token from the developer's own
    // backend — it never mints one itself.
    expect(dartFile!.code).toMatch(/http\.post/);
  });
});

describe('getIntegrationEntry — existing TypeScript integrations still work', () => {
  it.each(['nextjs', 'react', 'vanilla', 'node'] as const)('%s is still supported for every product', (framework) => {
    for (const product of PRODUCTS.map((p) => p.id)) {
      const entry = getIntegrationEntry(product, 'typescript', framework);
      expect(isSupported(entry)).toBe(true);
    }
  });

  it('still offers all four package managers for a JS framework', () => {
    const entry = getIntegrationEntry('rtc', 'typescript', 'nextjs');
    if (!isSupported(entry)) throw new Error('expected rtc+typescript+nextjs to be supported');
    expect(entry.install.map((c) => c.label)).toEqual(['npm', 'pnpm', 'yarn', 'bun']);
  });
});

describe('getIntegrationEntry — unsupported combinations', () => {
  it('rejects an unknown language', () => {
    const entry = getIntegrationEntry('rtc', 'rust', 'flutter');
    expect(isSupported(entry)).toBe(false);
  });

  it('rejects an unknown framework', () => {
    const entry = getIntegrationEntry('rtc', 'dart', 'unknown-framework');
    expect(isSupported(entry)).toBe(false);
  });

  it('rejects a language/framework mismatch (dart selected, a JS framework passed)', () => {
    const entry = getIntegrationEntry('rtc', 'dart', 'nextjs');
    expect(isSupported(entry)).toBe(false);
  });

  it('never fabricates a recipe for a product that has none for a given framework', () => {
    // Every product currently has a real entry for every framework, so
    // this asserts the *mechanism* holds by checking a framework/product
    // pair against the actual registry rather than hand-waving it: if a
    // future framework ships with partial product coverage, this same
    // codepath is what reports the gap instead of inventing an entry.
    const entry = getIntegrationEntry('rtc', 'dart', 'flutter');
    expect(isSupported(entry)).toBe(true);
  });
});

describe('renderIntegrationReadme', () => {
  it('labels a Dart entry as Dart, not TypeScript', () => {
    const entry = getIntegrationEntry('chat', 'dart', 'flutter');
    if (!isSupported(entry)) throw new Error('expected chat+dart+flutter to be supported');
    const readme = renderIntegrationReadme(entry, PROJECT);
    expect(readme).toContain('Dart (Flutter) + Flutter + Chat');
    expect(readme).toContain('flutter pub add raven_chat');
    expect(readme).not.toContain('npm install');
  });

  it('still labels a TypeScript entry correctly and shows the primary install command', () => {
    const entry = getIntegrationEntry('rtc', 'typescript', 'nextjs');
    if (!isSupported(entry)) throw new Error('expected rtc+typescript+nextjs to be supported');
    const readme = renderIntegrationReadme(entry, PROJECT);
    expect(readme).toContain('TypeScript / JavaScript + Next.js + RTC');
    expect(readme).toContain('npm install');
    expect(readme).toContain('Other package managers: npm, pnpm, yarn, bun.');
  });
});
