// A third-party developer's own backend. It knows two things about Livqeno:
// the project API key, and POST /v1/chat/tokens. Nothing else.
import http from 'http';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAVEN = process.env.RAVEN_BASE;
const API_KEY = process.env.RAVEN_API_KEY;
const ROOM = process.env.RAVEN_ROOM;
const PORT = Number(process.env.PORT ?? 5199);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json', '.css': 'text/css' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // The only Livqeno call this app's backend makes.
  if (url.pathname === '/api/chat-token') {
    const userId = url.searchParams.get('user');
    const r = await fetch(`${RAVEN}/v1/chat/tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ userId, conversations: [ROOM], ttlSeconds: 21600 }),
    });
    const grant = await r.json();
    res.writeHead(r.status, { 'content-type': 'application/json' });
    // Forward the mint response verbatim — that is the documented pattern.
    res.end(JSON.stringify({ ...grant, room: ROOM }));
    return;
  }

  const file = url.pathname === '/' ? '/index.html' : url.pathname;
  const path = join(HERE, 'public', file);
  if (!existsSync(path)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
  res.end(readFileSync(path));
});
server.listen(PORT, '0.0.0.0', () => console.log(`third-party app on http://localhost:${PORT}`));
