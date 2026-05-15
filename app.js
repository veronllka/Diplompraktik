const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleApi, DB_FILE } = require('./server-db');

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  if ((req.url || '').startsWith('/api/')) {
    handleApi(req, res);
    return;
  }

  serveStatic(req, res);
});

function serveStatic(req, res) {
  const cleanUrl = (req.url || '/').split('?')[0].replace(/^\/+/, '') || 'index.html';
  const normalized = path.normalize(cleanUrl);
  const filePath = path.resolve(path.join(publicDir, normalized));
  const publicPath = path.resolve(publicDir);

  if (!filePath.startsWith(publicPath + path.sep) && filePath !== publicPath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error && error.code === 'ENOENT') {
      fs.readFile(path.join(publicDir, 'index.html'), writeFile(res, '.html'));
      return;
    }

    if (error) {
      res.writeHead(500);
      res.end('Server error');
      return;
    }

    writeFile(res, path.extname(filePath))(null, content);
  });
}

function writeFile(res, ext) {
  return (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600'
    });
    res.end(content);
  };
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on port ${PORT}`);
  console.log(`Embedded database: ${DB_FILE}`);
});
