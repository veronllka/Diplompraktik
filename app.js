const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const sql = require('mssql');

const PORT = process.env.PORT || 3000;
const API_PROXY_TARGET = (process.env.API_PROXY_TARGET || process.env.BRIGADE_API_BASE_URL || '').replace(/\/+$/, '');
const DB_CONNECTION_STRING = process.env.DB_CONNECTION_STRING || process.env.ConnectionStrings__BrigadePlanner || '';
const DB_AUTO_INIT = parseBoolean(process.env.DB_AUTO_INIT, Boolean(DB_CONNECTION_STRING));
const DB_INIT_REQUIRED = parseBoolean(process.env.DB_INIT_REQUIRED, true);
const DB_INIT_SCRIPT = process.env.DB_INIT_SCRIPT || path.join(__dirname, 'sql', '01-init-server-db.sql');
const DB_RUNTIME_SCRIPT = process.env.DB_RUNTIME_SCRIPT || path.join(__dirname, 'sql', '03-ensure-runtime-schema.sql');
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

startServer();

async function startServer() {
  try {
    await initializeDatabaseIfNeeded();
  } catch (error) {
    console.error('Database auto-initialization failed:', error.message);
    if (DB_INIT_REQUIRED) {
      process.exitCode = 1;
      return;
    }
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server started on port ${PORT}`);
  });
}

async function initializeDatabaseIfNeeded() {
  if (!DB_AUTO_INIT) {
    console.log('Database auto-initialization is disabled.');
    return;
  }

  if (!DB_CONNECTION_STRING) {
    console.log('Database auto-initialization skipped: DB_CONNECTION_STRING is not configured.');
    return;
  }

  console.log('Checking BrigadePlanner database schema...');
  const pool = await sql.connect(DB_CONNECTION_STRING);
  try {
    const state = await getDatabaseState(pool);

    if (state.tableCount === 0) {
      console.log('Database is empty. Running initial schema and demo data script...');
      await runSqlFile(pool, DB_INIT_SCRIPT, true);
    } else if (!state.hasUsersTable) {
      throw new Error('Database contains tables, but dbo.Users is missing. Refusing to run destructive init script automatically.');
    }

    await runSqlFile(pool, DB_RUNTIME_SCRIPT, true);
    console.log('Database schema is ready.');
  } finally {
    await pool.close();
  }
}

async function getDatabaseState(pool) {
  const result = await pool.request().query(`
    SELECT
      COUNT(*) AS TableCount,
      CASE WHEN OBJECT_ID(N'dbo.Users', N'U') IS NULL THEN 0 ELSE 1 END AS HasUsersTable
    FROM sys.tables
    WHERE is_ms_shipped = 0;
  `);

  const row = result.recordset[0] || {};
  return {
    tableCount: Number(row.TableCount || 0),
    hasUsersTable: Number(row.HasUsersTable || 0) === 1
  };
}

async function runSqlFile(pool, filePath, skipDatabaseBatches) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`SQL file not found: ${filePath}`);
  }

  const script = fs.readFileSync(filePath, 'utf8');
  const batches = splitSqlBatches(script)
    .filter(batch => !skipDatabaseBatches || !isDatabaseContextBatch(batch));

  for (const batch of batches) {
    await pool.request().batch(batch);
  }
}

function splitSqlBatches(script) {
  return script
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .split(/^\s*GO\s*;?\s*$/gim)
    .map(batch => batch.trim())
    .filter(Boolean);
}

function isDatabaseContextBatch(batch) {
  return /^USE\s+\[?BrigadePlanner\]?/i.test(batch)
    || (/^IF\s+DB_ID\s*\(/i.test(batch) && /\bCREATE\s+DATABASE\b/i.test(batch));
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}
