// Phase 14 — two real browser windows (Chrome for Testing), each running the
// standalone third-party app. No Raven dashboard, no Playground, no internal
// hooks: the page imports exactly one thing, the built @ravenkash/chat bundle.
import { chromium } from 'playwright-core';
import { test, note, eq, ok, summary } from './runner.mjs';
import { sleep } from './lib.mjs';
import { readFileSync } from 'fs';

const APP = 'http://localhost:5199';
const EXEC = process.env.CHROMIUM;
const room = readFileSync(new URL('../thirdparty-app/room.env', import.meta.url), 'utf8').match(/RAVEN_ROOM=(\S+)/)[1];

console.log('\n########## PHASE 14 — BROWSER E2E (public SDK only) ##########\n');
console.log(`  app: ${APP}  room: ${room}  browser: Chrome for Testing (2 isolated contexts)\n`);

const browser = await chromium.launch({ executablePath: EXEC, headless: true });
const mk = async (user) => {
  const context = await browser.newContext(); // separate origin storage per "person"
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${APP}/?user=${user}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__acme?.api && window.__acme.chat.connectionState === 'connected', null, {
    timeout: 20000,
  });
  return { page, context, errors, user };
};

let alice = await mk('alice');
const bob = await mk('bob');
await sleep(800);

const api = (c, fn, ...args) => c.page.evaluate(({ fn, args }) => window.__acme.api[fn](...args), { fn, args });
const res = (c) => c.page.evaluate(() => window.__acme.results);
const state = (c) => c.page.evaluate(() => window.__acme.chat.connectionState);

await test('both browsers connect using only the public SDK', async () => {
  eq(await state(alice), 'connected', 'alice connected');
  eq(await state(bob), 'connected', 'bob connected');
  eq(alice.errors, [], "no page errors in alice's browser");
  eq(bob.errors, [], "no page errors in bob's browser");
  const uid = await alice.page.evaluate(() => window.__acme.chat.userId);
  eq(uid, 'alice', 'identity comes from the token');
});

await test('the page never sees an API key, only a minted grant', async () => {
  const html = await alice.page.content();
  ok(!html.includes('rvk_'), 'no API key anywhere in the delivered page');
  const grant = await alice.page.evaluate(() => window.__acme.grant);
  ok(grant.token && grant.chatUrl && grant.apiUrl, 'grant is token + chatUrl + apiUrl');
  ok(!('apiKey' in grant), 'grant carries no API key');
});

await test('Alice → Bob message delivery in a real browser', async () => {
  await api(alice, 'send', 'hello bob, from a real browser');
  await sleep(1200);
  const bobMsgs = (await res(bob)).messages.filter((m) => m.text);
  ok(
    bobMsgs.some((m) => m.text === 'hello bob, from a real browser' && m.from === 'alice'),
    'bob rendered it with the right sender',
  );
  const aliceMsgs = (await res(alice)).messages.filter((m) => m.text);
  ok(
    aliceMsgs.some((m) => m.text === 'hello bob, from a real browser'),
    'alice sees her own message echoed',
  );
});

await test('Bob → Alice reply', async () => {
  await api(bob, 'send', 'hi alice, got it');
  await sleep(1200);
  const aliceMsgs = (await res(alice)).messages.filter((m) => m.text);
  ok(
    aliceMsgs.some((m) => m.text === 'hi alice, got it' && m.from === 'bob'),
    "alice received bob's reply",
  );
});

await test('typing indicators cross the wire between the two browsers', async () => {
  await api(alice, 'startTyping');
  await sleep(800);
  const bobTyping = (await res(bob)).typing;
  ok(
    bobTyping.some((t) => t.userId === 'alice' && t.isTyping),
    'bob saw alice start typing',
  );
  await api(alice, 'stopTyping');
  await sleep(800);
  ok(
    (await res(bob)).typing.some((t) => t.userId === 'alice' && !t.isTyping),
    'bob saw alice stop',
  );
  const aliceOwn = (await res(alice)).typing.filter((t) => t.userId === 'alice');
  eq(aliceOwn, [], 'alice never sees her own typing echoed');
});

await test('presence shows both users to both browsers', async () => {
  const p = await api(alice, 'presence');
  eq(p.map((x) => x.userId).sort(), ['alice', 'bob'], 'alice sees both');
  const p2 = await api(bob, 'presence');
  eq(p2.map((x) => x.userId).sort(), ['alice', 'bob'], 'bob sees both');
});

await test('read receipts flow browser-to-browser', async () => {
  const before = await api(bob, 'readState');
  ok(before.unreadCount > 0, `bob has unread (${before.unreadCount})`);
  await api(bob, 'markLastRead');
  await sleep(1000);
  const aliceReads = (await res(alice)).reads;
  ok(
    aliceReads.some((r) => r.userId === 'bob'),
    'alice was told bob read',
  );
  const after = await api(bob, 'readState');
  eq(after.unreadCount, 0, "bob's unread count went to 0");
});

await test('reactions flow browser-to-browser', async () => {
  await api(alice, 'reactTo', 0, '👍');
  await sleep(1000);
  const bobRx = (await res(bob)).reactions;
  ok(
    bobRx.some((r) => r.kind === 'added' && r.emoji === '👍' && r.userId === 'alice'),
    'bob saw the reaction',
  );
  await api(alice, 'unreactTo', 0, '👍');
  await sleep(1000);
  ok(
    (await res(bob)).reactions.some((r) => r.kind === 'removed' && r.emoji === '👍'),
    'bob saw the removal',
  );
});

await test('history + pagination from the browser', async () => {
  for (let i = 0; i < 12; i++) {
    await api(alice, 'send', `page-${i}`);
  }
  await sleep(1500);
  const p1 = await api(bob, 'history', { limit: 5 });
  eq(p1.data.length, 5, 'first page of 5');
  ok(p1.nextCursor, 'nextCursor issued');
  const p2 = await api(bob, 'history', { limit: 5, before: p1.nextCursor });
  eq(p2.data.length, 5, 'second page of 5');
  const overlap = p1.data.map((m) => m.id).filter((id) => p2.data.some((m) => m.id === id));
  eq(overlap, [], 'no overlap between pages');
});

await test('soft delete renders as a placeholder, not a hole', async () => {
  const deleted = await api(alice, 'deleteLast');
  eq(deleted.deleted, true, 'marked deleted');
  eq(deleted.text, null, 'body removed from the payload');
  await sleep(1000);
  const bobMsgs = (await res(bob)).messages;
  ok(
    bobMsgs.some((m) => m.deleted === deleted.id),
    'bob got the deletion event and kept the position',
  );
});

await test('typing does not create messages (browser view agrees with the DB)', async () => {
  const before = (await api(bob, 'history', { limit: 100 })).data.length;
  for (let i = 0; i < 8; i++) {
    await api(alice, 'startTyping');
    await sleep(80);
  }
  await api(alice, 'stopTyping');
  await sleep(800);
  eq((await api(bob, 'history', { limit: 100 })).data.length, before, 'message count unchanged');
});

await test('Alice closes her tab → Bob sees her go offline; Alice reopens → back online', async () => {
  await alice.page.close();
  await alice.context.close();
  await sleep(2000);
  const p = await api(bob, 'presence');
  ok(!p.some((x) => x.userId === 'alice'), `alice offline after closing her browser (${JSON.stringify(p)})`);

  const alice2 = await mk('alice');
  await sleep(1500);
  const p2 = await api(bob, 'presence');
  ok(
    p2.some((x) => x.userId === 'alice' && x.status === 'online'),
    'alice back online after reopening the page',
  );
  // Reopened page loads history — proving persistence across a real page reload.
  const loaded = (await res(alice2)).messages;
  note(`alice's reopened tab rendered ${loaded.length} live messages after loading history`);
  const hist = await api(alice2, 'history', { limit: 100 });
  ok(hist.data.length >= 12, `full history retrievable after reload (${hist.data.length} messages)`);
  alice = alice2;
});

await test('gateway restart → both browsers reconnect with NO page refresh', async () => {
  const { execSync, spawn } = await import('child_process');
  const idBefore = await alice.page.evaluate(() => window.__acme.chat.id);
  execSync('pkill -f "node dist/main.js"');
  await sleep(2500);
  const during = await state(alice);
  ok(['reconnecting', 'disconnected', 'failed'].includes(during), `alice noticed the outage: ${during}`);

  const env = {
    ...process.env,
    CHAT_SEND_RATE_LIMIT: '100000',
    CHAT_CONNECTION_RATE_LIMIT: '100000',
    CHAT_SUBSCRIBE_RATE_LIMIT: '100000',
    CHAT_TYPING_RATE_LIMIT: '100000',
    CHAT_REACTION_RATE_LIMIT: '100000',
  };
  spawn('node', ['dist/main.js'], { cwd: process.env.API_CWD, env, detached: true, stdio: 'ignore' }).unref();

  const deadline = Date.now() + 120000;
  while (Date.now() < deadline && !((await state(alice)) === 'connected' && (await state(bob)) === 'connected'))
    await sleep(1000);
  eq(await state(alice), 'connected', 'alice reconnected by herself');
  eq(await state(bob), 'connected', 'bob reconnected by himself');
  const idAfter = await alice.page.evaluate(() => window.__acme.chat.id);
  ok(idAfter && idAfter !== idBefore, 'a new connection was established, not the old one resumed');
  note(`connection ${idBefore} → ${idAfter}, no reload issued`);

  // And it actually works again.
  await api(alice, 'send', 'after the gateway restart');
  await sleep(1500);
  ok(
    (await res(bob)).messages.some((m) => m.text === 'after the gateway restart'),
    'fan-out works after the restart with no refresh',
  );
});

await test('no duplicate messages in either browser across the whole session', async () => {
  eq((await res(alice)).duplicates, 0, 'alice saw no duplicates');
  eq((await res(bob)).duplicates, 0, 'bob saw no duplicates');
  const bobIds = (await res(bob)).messages.filter((m) => m.id).map((m) => m.id);
  eq(bobIds.length, new Set(bobIds).size, "bob's message ids are unique");
});

await test('no uncaught page errors in either browser for the whole run', async () => {
  const ignore = (e) => /WebSocket connection.*failed|Failed to load resource|ERR_CONNECTION/i.test(e);
  eq(
    alice.errors.filter((e) => !ignore(e)),
    [],
    `alice page errors: ${JSON.stringify(alice.errors)}`,
  );
  eq(
    bob.errors.filter((e) => !ignore(e)),
    [],
    `bob page errors: ${JSON.stringify(bob.errors)}`,
  );
  note(
    `expected transport errors during the deliberate outage: alice ${alice.errors.length}, bob ${bob.errors.length}`,
  );
});

await alice.page.screenshot({ path: new URL('../phase14-alice.png', import.meta.url).pathname, fullPage: true });
await bob.page.screenshot({ path: new URL('../phase14-bob.png', import.meta.url).pathname, fullPage: true });
await browser.close();
const r = summary('PHASE 14');
process.exit(r.failures.length ? 1 : 0);
