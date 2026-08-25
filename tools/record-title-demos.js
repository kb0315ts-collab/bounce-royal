'use strict';

// Local-only helper for recording the live title battle canvas. It also serves
// the game with byte-range support so the generated videos can be QA'd locally.
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'assets', 'title-demos');
const port = Number(process.env.BOUNCE_RECORD_PORT || 8765);
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

fs.mkdirSync(outputDir, { recursive: true });

function sendFile(req, res, filePath) {
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const type = mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) { res.writeHead(416); res.end(); return; }
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start > end || start >= stat.size) { res.writeHead(416); res.end(); return; }
      res.writeHead(206, {
        'Content-Type': type, 'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(filePath).pipe(res);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  if (req.method === 'POST' && url.pathname === '/__recording_upload__') {
    const name = url.searchParams.get('name') || '';
    if (!/^title-demo-0[1-6]\.(?:mp4|webm)$/.test(name)) {
      res.writeHead(400); res.end('Invalid recording name'); return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 12 * 1024 * 1024) req.destroy();
      else chunks.push(chunk);
    });
    req.on('end', () => {
      fs.writeFileSync(path.join(outputDir, name), Buffer.concat(chunks));
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name, size }));
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const filePath = path.resolve(root, relative);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  sendFile(req, res, filePath);
}).listen(port, '127.0.0.1', () => {
  console.log(`Bounce Royal recorder: http://127.0.0.1:${port}/`);
});
