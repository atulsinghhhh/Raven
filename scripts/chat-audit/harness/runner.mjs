// Tiny assertion runner so every phase reports the same way.
const results = [];
let current = null;

export async function test(name, fn) {
  const start = Date.now();
  current = { name, checks: [] };
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - start, checks: current.checks });
    console.log(`  PASS  ${name} (${Date.now() - start}ms)`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - start, error: err.message, checks: current.checks });
    console.log(`  FAIL  ${name} — ${err.message}`);
  }
  current = null;
}

export function note(msg) { if (current) current.checks.push(msg); console.log(`        · ${msg}`); }

export function eq(actual, expected, what) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
export function ok(cond, what) { if (!cond) throw new Error(what); }

export function summary(label) {
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok);
  console.log(`\n=== ${label}: ${pass}/${results.length} passed ===`);
  for (const f of fail) console.log(`  FAILED: ${f.name} — ${f.error}`);
  return { pass, total: results.length, failures: fail };
}
