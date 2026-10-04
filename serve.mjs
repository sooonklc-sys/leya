import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const project = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(project, 'dist');
const config = JSON.parse(await fs.readFile(path.join(project, 'config/server.json'), 'utf8'));
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};

/** Serve assets only. Imported laboratory files remain in the browser. */
export function createAppServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, {'Allow': 'GET, HEAD'});
        return res.end();
      }
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const target = path.resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1));
      if (!target.startsWith(root + path.sep)) {
        res.writeHead(403);
        return res.end();
      }
      const data = await fs.readFile(target);
      res.writeHead(200, {
        'Content-Type': mime[path.extname(target)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? config.port);
  const host = process.env.HOST ?? config.host;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT должен быть от 1 до 65535.');
  createAppServer().listen(port, host, () => console.log(`Лея: http://${host}:${port}/ — остановка Ctrl+C`));
}
