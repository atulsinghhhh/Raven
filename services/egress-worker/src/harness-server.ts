import { createReadStream, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
};

/**
 * Serves the harness directory over loopback HTTP. Not `file://`: Chromium
 * refuses to load a `type="module"` script from a `file://` origin
 * ("Cross origin requests are only supported for protocol schemes:
 * chrome, chrome-untrusted, data, http, https") — the harness page is a
 * module (it imports `@ravenkash/client`), so it needs a real origin.
 * Same reasoning and same shape as `scripts/capacity/lib/stack.mjs`'s own
 * harness server, which hit this exact requirement first.
 */
export function startHarnessServer(harnessDir: string): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const requested = (req.url ?? '/').split('?')[0];
    const filePath = normalize(join(harnessDir, requested === '/' ? 'viewer.html' : requested));
    if (!filePath.startsWith(harnessDir) || !existsSync(filePath)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}
