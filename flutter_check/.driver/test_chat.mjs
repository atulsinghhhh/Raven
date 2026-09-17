import { chromium } from 'playwright';
import { serve, makeConversation, chatToken, waitForState, record, patch } from './lib.mjs';

const url = (port, params) => `http://localhost:${port}/?` + new URLSearchParams(params).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await serve('chat', 8801);
const ts = Date.now();
const conv = await makeConversation(`sdktest-chat-${ts}`, [{ userId: 'alice' }, { userId: 'bob' }]);
console.log(`\n### raven_chat — conversation ${conv.publicId}\n`);

const ta = await chatToken('alice', [conv.publicId]);
const tb = await chatToken('bob', [conv.publicId]);

const browser = await chromium.launch();
const ctx = await browser.newContext();
const pA = await ctx.newPage();
const pB = await ctx.newPage();
for (const p of [pA, pB]) p.on('pageerror', (e) => console.log('  PAGEERROR', String(e).slice(0, 200)));

try {
  await pA.goto(url(8801, { token: ta.token, apiUrl: ta.apiUrl, room: conv.publicId }));
  await pB.goto(url(8801, { token: tb.token, apiUrl: tb.apiUrl, room: conv.publicId }));
  const sA = await waitForState(pA, (s) => s.ready || s.error, { label: 'alice ready' });
  const sB = await waitForState(pB, (s) => s.ready || s.error, { label: 'bob ready' });
  record('raven_chat', 'connect() completes the auth handshake', !!sA.ready && !!sB.ready, `alice=${sA.connectionState} bob=${sB.connectionState}`);

  // --- send / receive
  await pA.evaluate(() => globalThis.__doSend('hello from alice'));
  const sent = await waitForState(pA, (s) => s.lastSent?.text === 'hello from alice', { label: 'alice send ack' }).catch((e) => ({ _err: e.message }));
  record('raven_chat', 'send() resolves with the stored message', !sent._err, sent._err ? sent._err.slice(0, 100) : `id=${sent.lastSent?.id}`);
  const got = await waitForState(pB, (s) => (s.messages ?? []).some((m) => m.text === 'hello from alice'), { label: 'bob receives' }).catch((e) => ({ _err: e.message }));
  record('raven_chat', 'messages stream delivers to the other member', !got._err, got._err ? 'not received' : 'received');

  const msgId = sent.lastSent?.id;

  // --- history. __doHistory takes a `before` cursor ('' = newest page).
  // Seed a few more messages first so pagination has something to page.
  for (let i = 0; i < 3; i++) await pA.evaluate((n) => globalThis.__doSend(`filler ${n}`), i);
  await sleep(1500);
  await pB.evaluate(() => globalThis.__doHistory(''));
  const hist = await waitForState(pB, (s) => Array.isArray(s.lastHistory?.messages) || s.historyError, { label: 'history' }).catch((e) => ({ _err: e.message }));
  const hOk = !hist._err && !hist.historyError && hist.lastHistory?.messages?.length > 0;
  record('raven_chat', 'history() returns a page of stored messages', hOk, hOk ? `${hist.lastHistory.messages.length} messages, hasMore=${hist.lastHistory.hasMore}` : (hist.historyError ?? hist._err ?? '').toString().slice(0, 110));

  // Page backwards with the cursor the first page handed back.
  const cursor = hist.lastHistory?.nextCursor;
  if (cursor) {
    await pB.evaluate((c) => globalThis.__doHistory(c), cursor);
    const p2 = await waitForState(pB, (s) => s.lastHistory?.nextCursor !== cursor || s.historyError, { label: 'history page 2', timeout: 20000 }).catch((e) => ({ _err: e.message }));
    record('raven_chat', 'history() pages with the returned cursor', !p2._err && !p2.historyError, p2.historyError ?? (p2._err ? 'timeout' : 'second page fetched'));
  } else {
    record('raven_chat', 'history() pages with the returned cursor', true, 'single page — nextCursor null, nothing to page');
  }

  // --- edit
  await pA.evaluate((id) => globalThis.__doEdit(id, 'edited by alice'), msgId);
  const ed = await waitForState(pA, (s) => s.lastEdited?.text === 'edited by alice', { label: 'edit' }).catch((e) => ({ _err: e.message }));
  record('raven_chat', 'edit() updates the message', !ed._err, ed._err ? 'failed' : 'text updated');
  const edB = await waitForState(pB, (s) => (s.messageUpdates ?? []).some((m) => m.text === 'edited by alice'), { label: 'edit fanout' }).catch((e) => ({ _err: e.message }));
  record('raven_chat', 'messageUpdates stream fires on the peer', !edB._err, edB._err ? 'no update event' : 'update received');

  // --- reactions
  await pB.evaluate((id) => globalThis.__doAddReaction(id, '👍'), msgId);
  const rx = await waitForState(pA, (s) => (s.reactionEvents ?? []).length > 0, { label: 'reaction fanout' }).catch((e) => ({ _err: e.message }));
  record('raven_chat', 'reactions stream fires', !rx._err, rx._err ? 'no reaction event' : JSON.stringify(rx.reactionEvents[0]).slice(0, 90));

  // --- typing
  await pA.evaluate(() => globalThis.__doStartTyping());
  const ty = await waitForState(pB, (s) => (s.typingEvents ?? []).some((e) => e.isTyping), { label: 'typing' }).catch((e) => ({ _err: e.message }));
  record('raven_chat', 'typing stream fires', !ty._err, ty._err ? 'no typing event' : 'isTyping=true received');
  await pA.evaluate(() => globalThis.__doStopTyping());

  // --- read receipts
  await pB.evaluate((id) => globalThis.__doMarkAsRead(id), msgId);
  const rr = await waitForState(pA, (s) => (s.readReceipts ?? []).length > 0, { label: 'read receipt' }).catch((e) => ({ _err: e.message }));
  record('raven_chat', 'readReceipts stream fires', !rr._err, rr._err ? 'no read receipt' : JSON.stringify(rr.readReceipts[0]).slice(0, 90));

  // --- presence
  await pA.evaluate(() => globalThis.__doSetPresence('away'));
  await sleep(1500);
  await pB.evaluate(() => globalThis.__doGetPresence());
  const pr = await waitForState(pB, (s) => Array.isArray(s.presenceSnapshot), { label: 'presence' }).catch((e) => ({ _err: e.message }));
  record('raven_chat', 'presence set + query', !pr._err && pr.presenceSnapshot.length > 0, pr._err ? 'failed' : JSON.stringify(pr.presenceSnapshot).slice(0, 110));

  // --- delete (soft: tombstone, no body)
  await pA.evaluate((id) => globalThis.__doDelete(id), msgId);
  const dl = await waitForState(pA, (s) => !!s.lastDeleted, { label: 'delete' }).catch((e) => ({ _err: e.message }));
  record('raven_chat', 'delete() soft-deletes', !dl._err && dl.lastDeleted?.deleted === true, dl._err ? 'failed' : `deleted=${dl.lastDeleted?.deleted}`);
  const dlB = await waitForState(pB, (s) => (s.messageDeletions ?? []).length > 0, { label: 'delete fanout' }).catch((e) => ({ _err: e.message }));
  record('raven_chat', 'messageDeletions stream fires', !dlB._err, dlB._err ? 'no deletion event' : 'deletion received');

  // --- HTTP fallback: kill the socket, send anyway.
  await pA.evaluate(() => globalThis.__doDisconnect());
  await waitForState(pA, (s) => s.phase === 'disconnected' || s.connectionState === 'disconnected', { label: 'disconnected' }).catch(() => {});
  await pA.evaluate(() => globalThis.__doSend('sent while the socket is down'));
  const fb = await waitForState(pA, (s) => s.lastSent?.text === 'sent while the socket is down' || s.sendError, { label: 'offline send', timeout: 30000 }).catch((e) => ({ _err: e.message }));
  const landed = !fb._err && !fb.sendError && fb.lastSent?.text === 'sent while the socket is down';
  record('raven_chat', 'send() falls back to HTTP when the socket is down', landed, landed ? 'stored over REST' : (fb.sendError ?? fb._err ?? 'unknown').toString().slice(0, 110));
  const seenByBob = await waitForState(pB, (s) => (s.messages ?? []).some((m) => m.text === 'sent while the socket is down'), { label: 'fallback fanout', timeout: 20000 }).catch(() => null);
  record('raven_chat', 'HTTP-sent message still fans out to the peer', !!seenByBob, seenByBob ? 'bob received it' : 'bob never saw it');
} finally {
  await browser.close(); server.close();
  await patch(`/v1/chat/conversations/${conv.publicId}`, { status: 'ARCHIVED' }).catch(() => {});
}
