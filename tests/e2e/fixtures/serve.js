// Serves the fixture pages over http. Content scripts declared for <all_urls> do
// not match file:// URLs, so the walking skeleton test needs a real http origin.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, 'pages');
const PORT = Number(process.env.FIXTURE_PORT || 5599);

const server = http.createServer((req, res) => {
  const name = (req.url || '/').split('?')[0].replace(/^\/+/, '') || 'click-target.html';
  const file = path.join(ROOT, name);

  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }

  let body;
  try {
    body = fs.readFileSync(file);
  } catch {
    res.writeHead(404);
    res.end('not found');
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
});

server.listen(PORT, () => {
  console.log(`fixture server listening on http://localhost:${PORT}`);
});
