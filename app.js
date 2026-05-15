const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const API_PROXY_TARGET = (process.env.API_PROXY_TARGET || process.env.BRIGADE_API_BASE_URL || '').replace(/\/+$/, '');
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
    proxyApi(req, res);
    return;
  }

  serveStatic(req, res);
});

function proxyApi(req, res) {
  if (!API_PROXY_TARGET) {
    sendJson(res, 502, { error: 'API_PROXY_TARGET is not configured' });
    return;
  }

  const target = new URL(req.url, API_PROXY_TARGET + '/');
  const transport = target.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: target.host };

  const proxyReq = transport.request(target, {
    method: req.method,
    headers
  }, proxyRes => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', error => {
    sendJson(res, 502, { error: 'API proxy failed', detail: error.message });
  });

  req.pipe(proxyReq);
}

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

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on port ${PORT}`);
});
