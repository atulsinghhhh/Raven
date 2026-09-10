// Deep-pagination benchmark through the public REST API, against the 200k-row
// conversation seeded in Phase 11.
import { http, must } from './lib.mjs';
import { readFileSync } from 'fs';
const ctx = JSON.parse(readFileSync('./ctx.json', 'utf8'));
const room = 'conv_bulk_idx_test';

let cursor = null, page = 0;
const marks = new Set([1, 10, 50, 100, 200, 400]);
const timings = [];
while (page < 400) {
  const q = new URLSearchParams({ limit: '50' });
  if (cursor) q.set('before', cursor);
  const t0 = Date.now();
  const r = must(await http(`/v1/chat/conversations/${room}/messages?${q}`, { token: ctx.apiKey }), 200, 'page');
  const ms = Date.now() - t0;
  page++;
  if (marks.has(page)) timings.push({ page, depth: page * 50, ms, rows: r.data.length });
  cursor = r.nextCursor;
  if (!cursor) break;
}
console.log('depth (rows into the conversation) → latency for one 50-row page:');
for (const t of timings) console.log(`  page ${String(t.page).padStart(3)}  depth ${String(t.depth).padStart(6)}  ${String(t.ms).padStart(4)} ms  (${t.rows} rows)`);
const first = timings[0].ms, last = timings.at(-1).ms;
console.log(`\nflatness: page 1 = ${first}ms, page ${timings.at(-1).page} = ${last}ms → ratio ${(last / Math.max(first,1)).toFixed(2)}x`);
