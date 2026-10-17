'use strict';
// WAndCine — servidor (Node.js puro + SQLite embutido, sem dependências).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const db = require('./lib/db');
const auth = require('./lib/auth');
const { createTmdb, imdbId } = require('./lib/tmdb');
const imdbImport = require('./lib/imdb');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};
const PUBLIC_FILES = new Set(['/styles.css', '/login.js', '/favicon.svg', '/offline.html']); // acessíveis sem login
const COOKIE = 'ma_session';

function loadConfig(env) {
  env = env || process.env;
  const cfg = {
    port: parseInt(env.PORT, 10) || 3000,
    dataDir: path.resolve(env.DATA_DIR || path.join(__dirname, 'data')),
    username: (env.APP_USERNAME || 'wanderson').trim(),
    password: env.APP_PASSWORD || '',
    passwordHash: env.APP_PASSWORD_HASH || '',
    sessionSecret: env.SESSION_SECRET || '',
    sessionDays: parseInt(env.SESSION_DAYS, 10) || 30,
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    secureCookie: env.COOKIE_SECURE ? env.COOKIE_SECURE !== '0' : env.NODE_ENV === 'production',
    autoSeed: env.AUTO_SEED !== '0',
    seedFile: env.SEED_FILE || path.join(__dirname, 'seed', 'entries.json'),
    tmdbKey: env.TMDB_API_KEY || '',
    tmdbApiBase: env.TMDB_API_BASE || '',
    tmdbImageBase: env.TMDB_IMAGE_BASE || '',
    tmdbDelayMs: env.TMDB_DELAY_MS ? parseInt(env.TMDB_DELAY_MS, 10) : 150
  };
  return cfg;
}

function createApp(cfg) {
  if (!cfg.passwordHash && !cfg.password) {
    throw new Error('Defina APP_PASSWORD (ou APP_PASSWORD_HASH) para proteger o acesso.');
  }
  const passwordHash = cfg.passwordHash || auth.hashPassword(cfg.password);
  const secret = auth.loadSecret(cfg.sessionSecret, cfg.dataDir);
  const store = db.open(cfg.dataDir);
  const limiter = auth.createLimiter(5, 15 * 60 * 1000);
  const tmdb = createTmdb({ key: cfg.tmdbKey, apiBase: cfg.tmdbApiBase, imageBase: cfg.tmdbImageBase });

  // Tenta baixar o pôster de um registro sem capa. Nunca lança: falha vira "sem capa".
  async function autoCover(entry) {
    if (!tmdb || !entry || entry.coverUrl || entry.type === 'game' || !imdbId(entry.imdbUrl)) return entry;
    try {
      const buf = await tmdb.posterFor(entry);
      if (buf) return store.setCover(entry.id, buf) || entry;
    } catch (err) {
      console.warn('[capas]', entry.title + ':', err.message);
    }
    return entry;
  }

  // Busca em lote das capas que faltam (roda em segundo plano; o estado é consultado por /api/covers/sync).
  let job = { running: false, total: 0, done: 0, found: 0, missing: 0, failed: 0, error: null };
  async function runCoverSync() {
    const todo = store.list().filter((e) => !e.coverUrl && e.type !== 'game' && imdbId(e.imdbUrl));
    job = { running: true, total: todo.length, done: 0, found: 0, missing: 0, failed: 0, error: null };
    for (const e of todo) {
      try {
        const buf = await tmdb.posterFor(e);
        if (buf) { store.setCover(e.id, buf); job.found++; } else job.missing++;
      } catch (err) {
        if (err.fatal) { job.error = err.message; break; }
        job.failed++;
      }
      job.done++;
      if (cfg.tmdbDelayMs > 0) await new Promise((r) => setTimeout(r, cfg.tmdbDelayMs));
    }
    job.running = false;
  }

  if (cfg.autoSeed && store.count() === 0 && fs.existsSync(cfg.seedFile)) {
    try {
      const items = JSON.parse(fs.readFileSync(cfg.seedFile, 'utf8'));
      const seedCovers = path.join(path.dirname(cfg.seedFile), 'covers');
      const res = store.importMany(items, {
        coverResolver(e) {
          if (!e.id) return null;
          const f = ['jpg', 'png', 'webp', 'gif'].map((x) => path.join(seedCovers, e.id + '.' + x)).find((p) => fs.existsSync(p));
          return f ? fs.readFileSync(f) : null;
        }
      });
      console.log('[seed] registros iniciais importados:', JSON.stringify(res));
    } catch (err) {
      console.error('[seed] falhou:', err.message);
    }
  }

  // Fundo da imagem de compartilhamento (arquivo único em DATA_DIR, fora do Git).
  const BG_EXTS = ['jpg', 'png', 'webp', 'gif'];
  function findShareBg() {
    for (const ext of BG_EXTS) {
      const file = path.join(cfg.dataDir, 'share-bg.' + ext);
      if (fs.existsSync(file)) return { file, ext, version: Math.floor(fs.statSync(file).mtimeMs) };
    }
    return null;
  }
  function clearShareBg() {
    for (const ext of BG_EXTS) { try { fs.unlinkSync(path.join(cfg.dataDir, 'share-bg.' + ext)); } catch (_) { /* não existia */ } }
  }

  // Logo do app (arquivo único em DATA_DIR, fora do Git). É pública: aparece também na tela de login.
  function findLogo() {
    for (const ext of BG_EXTS) {
      const file = path.join(cfg.dataDir, 'logo.' + ext);
      if (fs.existsSync(file)) return { file, ext, version: Math.floor(fs.statSync(file).mtimeMs) };
    }
    return null;
  }
  function clearLogo() {
    for (const ext of BG_EXTS) { try { fs.unlinkSync(path.join(cfg.dataDir, 'logo.' + ext)); } catch (_) { /* não existia */ } }
  }
  const IMG_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

  const htmlCache = {};
  function page(name) {
    if (!htmlCache[name] || process.env.NODE_ENV !== 'production') {
      htmlCache[name] = fs.readFileSync(path.join(PUBLIC_DIR, name));
    }
    return htmlCache[name];
  }

  function clientIp(req) {
    if (cfg.trustProxy) {
      const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (xf) return xf;
    }
    return req.socket.remoteAddress || 'unknown';
  }
  function isSecure(req) {
    return cfg.secureCookie || (cfg.trustProxy && req.headers['x-forwarded-proto'] === 'https');
  }

  function baseHeaders(req) {
    const h = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src https://fonts.gstatic.com",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'"
      ].join('; ')
    };
    if (isSecure(req)) h['Strict-Transport-Security'] = 'max-age=15552000';
    return h;
  }

  function send(req, res, status, body, headers) {
    res.writeHead(status, Object.assign(baseHeaders(req), headers || {}));
    res.end(body);
  }
  function json(req, res, status, obj, headers) {
    send(req, res, status, JSON.stringify(obj), Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) {
          const e = new Error('Arquivo grande demais.'); e.status = 413;
          req.destroy(); reject(e); return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  async function readJson(req, limit) {
    const buf = await readBody(req, limit);
    try { return JSON.parse(buf.toString('utf8') || 'null'); }
    catch (_) { const e = new Error('JSON inválido.'); e.status = 400; throw e; }
  }

  function currentSession(req) {
    const token = auth.parseCookies(req.headers.cookie)[COOKIE];
    const s = auth.readSession(secret, token);
    return s && auth.safeEqual(s.u, cfg.username) ? s : null;
  }

  function cookieHeader(req, value, maxAgeSec) {
    return COOKIE + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAgeSec + (isSecure(req) ? '; Secure' : '');
  }

  // Bloqueia requisições que mudam dados vindas de outra origem.
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      const host = (cfg.trustProxy && req.headers['x-forwarded-host']) || req.headers.host;
      return new URL(origin).host === host;
    } catch (_) { return false; }
  }

  async function handleApi(req, res, url) {
    const method = req.method;
    const p = url.pathname;

    if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) {
      return json(req, res, 403, { error: 'Origem não permitida.' });
    }

    if (p === '/api/login' && method === 'POST') {
      const ip = clientIp(req);
      const wait = limiter.blocked(ip);
      if (wait) return json(req, res, 429, { error: 'Muitas tentativas. Tente de novo em ' + Math.ceil(wait / 60) + ' min.' }, { 'Retry-After': String(wait) });
      const body = await readJson(req, 4096);
      const okUser = auth.safeEqual((body && body.username) || '', cfg.username);
      const okPass = auth.verifyPassword(String((body && body.password) || ''), passwordHash);
      if (!(okUser && okPass)) {
        limiter.fail(ip);
        return json(req, res, 401, { error: 'Usuário ou senha incorretos.' });
      }
      limiter.reset(ip);
      const token = auth.createSession(secret, cfg.username, cfg.sessionDays);
      return json(req, res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, token, cfg.sessionDays * 86400) });
    }

    if (p === '/api/logout' && method === 'POST') {
      return json(req, res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
    }

    if (!currentSession(req)) return json(req, res, 401, { error: 'Sessão expirada. Entre novamente.' });

    if (p === '/api/me' && method === 'GET') {
      const bg = findShareBg();
      const logo = findLogo();
      return json(req, res, 200, { user: cfg.username, covers: !!tmdb, shareBg: bg ? bg.version : null, logo: logo ? logo.version : null });
    }

    if (p === '/api/share-bg') {
      if (method === 'PUT') {
        const buf = await readBody(req, 12 * 1024 * 1024);
        const kind = db.sniffImage(buf);
        if (!kind) return json(req, res, 415, { error: 'Envie uma imagem JPG, PNG, WEBP ou GIF.' });
        clearShareBg();
        fs.writeFileSync(path.join(cfg.dataDir, 'share-bg.' + kind.ext), buf);
        return json(req, res, 200, { shareBg: findShareBg().version });
      }
      if (method === 'DELETE') { clearShareBg(); return json(req, res, 200, { shareBg: null }); }
    }

    if (p === '/api/logo') {
      if (method === 'PUT') {
        const buf = await readBody(req, 6 * 1024 * 1024);
        const kind = db.sniffImage(buf);
        if (!kind) return json(req, res, 415, { error: 'Envie uma imagem JPG, PNG, WEBP ou GIF.' });
        clearLogo();
        fs.writeFileSync(path.join(cfg.dataDir, 'logo.' + kind.ext), buf);
        return json(req, res, 200, { logo: findLogo().version });
      }
      if (method === 'DELETE') { clearLogo(); return json(req, res, 200, { logo: null }); }
    }

    if (p === '/api/covers/sync') {
      if (!tmdb) return json(req, res, 503, { error: 'Busca de capas desativada. Defina TMDB_API_KEY no servidor.' });
      if (method === 'POST') {
        if (!job.running) runCoverSync().catch((err) => { job.running = false; job.error = err.message; });
        return json(req, res, 202, job);
      }
      if (method === 'GET') return json(req, res, 200, job);
    }

    if (p === '/api/entries' && method === 'GET') return json(req, res, 200, store.list());
    if (p === '/api/entries' && method === 'POST') {
      return json(req, res, 201, await autoCover(store.create(await readJson(req, 64 * 1024))));
    }

    if (p === '/api/export' && method === 'GET') {
      const withCovers = url.searchParams.get('covers') === '1';
      const stamp = new Date().toISOString().slice(0, 10);
      return json(req, res, 200, store.exportAll(withCovers), {
        'Content-Disposition': 'attachment; filename="meu-arquivo-' + stamp + (withCovers ? '-com-capas' : '') + '.json"'
      });
    }
    if (p === '/api/import/imdb' && method === 'POST') {
      const csv = (await readBody(req, 20 * 1024 * 1024)).toString('utf8');
      const { items, summary } = imdbImport.buildImport(csv, store.list());
      const result = store.importMany(items);
      console.log('[import imdb]', JSON.stringify(Object.assign({}, summary, result)));
      return json(req, res, 200, Object.assign({}, summary, result));
    }
    if (p === '/api/import' && method === 'POST') {
      const items = await readJson(req, 100 * 1024 * 1024);
      return json(req, res, 200, store.importMany(items));
    }

    const m = p.match(/^\/api\/entries\/([A-Za-z0-9_-]{1,40})(\/cover)?$/);
    if (m) {
      const id = m[1];
      let out;
      if (!m[2]) {
        if (method === 'GET') out = store.get(id);
        else if (method === 'PUT') out = await autoCover(store.update(id, await readJson(req, 64 * 1024)));
        else if (method === 'DELETE') {
          return store.remove(id) ? json(req, res, 200, { ok: true }) : json(req, res, 404, { error: 'Registro não encontrado.' });
        } else return json(req, res, 405, { error: 'Método não permitido.' });
      } else {
        if (method === 'PUT') out = store.setCover(id, await readBody(req, 8 * 1024 * 1024));
        else if (method === 'DELETE') out = store.clearCover(id);
        else return json(req, res, 405, { error: 'Método não permitido.' });
      }
      return out ? json(req, res, 200, out) : json(req, res, 404, { error: 'Registro não encontrado.' });
    }

    return json(req, res, 404, { error: 'Não encontrado.' });
  }

  function serveFile(req, res, file, mime, cache) {
    fs.readFile(file, (err, data) => {
      if (err) return send(req, res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
      send(req, res, 200, req.method === 'HEAD' ? '' : data, { 'Content-Type': mime, 'Cache-Control': cache });
    });
  }

  async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://x');
      const p = decodeURIComponent(url.pathname);

      if (p === '/healthz') return json(req, res, 200, { ok: true });
      if (p.startsWith('/api/')) return await handleApi(req, res, url);

      if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, 'Método não permitido');

      const logged = !!currentSession(req);

      if (p === '/login') {
        if (logged) return send(req, res, 302, '', { Location: '/' });
        return send(req, res, 200, page('login.html'), { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
      }
      if (p === '/sw.js') {
        return serveFile(req, res, path.join(PUBLIC_DIR, 'sw.js'), MIME['.js'], 'no-cache');
      }
      if (p === '/manifest.webmanifest') {
        const lg = findLogo();
        const v = lg ? '?v=' + lg.version : '';
        const type = lg ? IMG_MIME[lg.ext] : 'image/png';
        const icons = [
          { src: '/icon.png' + v, sizes: '192x192 512x512', type, purpose: 'any' },
          { src: '/icon.png' + v, sizes: '192x192 512x512', type, purpose: 'maskable' }
        ];
        const manifest = {
          name: 'WAndCine', short_name: 'WAndCine', description: 'Meu catálogo de filmes e séries',
          lang: 'pt-BR', id: '/', start_url: '/', scope: '/', display: 'standalone', orientation: 'portrait',
          background_color: '#1c1914', theme_color: '#1c1914', icons
        };
        return send(req, res, 200, JSON.stringify(manifest), { 'Content-Type': MIME['.webmanifest'], 'Cache-Control': 'no-cache' });
      }
      if (p === '/icon.png' || p === '/apple-touch-icon.png') {
        const lg = findLogo();
        const cache = url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'no-cache';
        if (lg) return serveFile(req, res, lg.file, IMG_MIME[lg.ext], cache);
        const def = path.join(PUBLIC_DIR, 'icons', p === '/icon.png' ? 'default-512.png' : 'default-180.png');
        return serveFile(req, res, def, 'image/png', 'no-cache');
      }
      if (p === '/logo') {
        const lg = findLogo();
        if (!lg) return send(req, res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
        return serveFile(req, res, lg.file, IMG_MIME[lg.ext], url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'no-cache');
      }
      if (PUBLIC_FILES.has(p)) {
        return serveFile(req, res, path.join(PUBLIC_DIR, p), MIME[path.extname(p)], 'no-cache');
      }

      // Tudo daqui para baixo exige login.
      if (!logged) {
        return p.startsWith('/covers/')
          ? send(req, res, 401, 'Não autorizado', { 'Content-Type': 'text/plain; charset=utf-8' })
          : send(req, res, 302, '', { Location: '/login' });
      }
      if (p === '/' || p === '/index.html') {
        return send(req, res, 200, page('index.html'), { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
      }
      if (p === '/app.js') return serveFile(req, res, path.join(PUBLIC_DIR, 'app.js'), MIME['.js'], 'no-cache');
      if (p === '/share-bg') {
        const bg = findShareBg();
        if (!bg) return send(req, res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
        return serveFile(req, res, bg.file, IMG_MIME[bg.ext], 'private, max-age=31536000, immutable');
      }
      if (p.startsWith('/covers/')) {
        const c = store.coverFile(p.slice('/covers/'.length));
        if (!c) return send(req, res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
        return serveFile(req, res, c.file, c.mime, 'private, max-age=31536000, immutable');
      }
      return send(req, res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) {
        return json(req, res, status, { error: status === 500 ? 'Erro interno.' : err.message });
      }
      res.end();
    }
  }

  const server = http.createServer(handler);
  server.on('close', () => store.close());
  server.keepAliveTimeout = 65000;
  server.requestTimeout = 120000;
  return { server, store };
}

module.exports = { createApp, loadConfig };

if (require.main === module) {
  const cfg = loadConfig();
  const { server } = createApp(cfg);
  server.listen(cfg.port, '0.0.0.0', () => {
    console.log('WAndCine rodando em http://localhost:' + cfg.port + ' (usuário: ' + cfg.username + ')');
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
