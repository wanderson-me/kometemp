'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, loadConfig } = require('../server');

let server, base, dir, cookie;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

async function call(method, url, body, headers) {
  const h = Object.assign({}, headers);
  if (cookie) h.cookie = cookie;
  let payload = body;
  if (body !== undefined && !Buffer.isBuffer(body)) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
  const res = await fetch(base + url, { method, headers: h, body: payload, redirect: 'manual' });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) { /* não é JSON */ }
  return { status: res.status, data, text, headers: res.headers };
}
async function login() {
  const r = await call('POST', '/api/login', { username: 'eu', password: 'senha-longa-123' });
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-test-'));
  const cfg = loadConfig({ DATA_DIR: dir, APP_USERNAME: 'eu', APP_PASSWORD: 'senha-longa-123', AUTO_SEED: '0' });
  ({ server } = createApp(cfg));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sem login: página redireciona e API responde 401', async () => {
  const page = await call('GET', '/');
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/login');
  assert.equal((await call('GET', '/api/entries')).status, 401);
  assert.equal((await call('GET', '/app.js')).status, 302);
  assert.equal((await call('GET', '/login')).status, 200);
  assert.equal((await call('GET', '/healthz')).status, 200);
});

test('login com senha errada falha; certa entra', async () => {
  const bad = await call('POST', '/api/login', { username: 'eu', password: 'errada' });
  assert.equal(bad.status, 401);
  assert.equal((await call('POST', '/api/login', { username: 'outro', password: 'senha-longa-123' })).status, 401);
  await login();
  const cookieHeader = (await call('POST', '/api/login', { username: 'eu', password: 'senha-longa-123' })).headers.get('set-cookie');
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Lax/);
  assert.equal((await call('GET', '/api/me')).data.user, 'eu');
});

test('cookie adulterado é recusado', async () => {
  const saved = cookie;
  cookie = saved.slice(0, -3) + 'xxx';
  assert.equal((await call('GET', '/api/entries')).status, 401);
  cookie = saved;
});

test('CRUD de registros', async () => {
  const created = await call('POST', '/api/entries', { type: 'movie', title: ' Filme Teste ', rating: 4, year: '1999', duration: 120, genres: ['Drama', 'Ação'], date: '2026-10-01' });
  assert.equal(created.status, 201);
  const id = created.data.id;
  assert.equal(created.data.title, 'Filme Teste');
  assert.deepEqual(created.data.genres, ['Drama', 'Ação']);

  const upd = await call('PUT', '/api/entries/' + id, { type: 'movie', title: 'Filme Editado', rating: 5, genres: [] });
  assert.equal(upd.data.title, 'Filme Editado');
  assert.equal(upd.data.rating, 5);

  const list = await call('GET', '/api/entries');
  assert.equal(list.data.length, 1);

  assert.equal((await call('DELETE', '/api/entries/' + id)).status, 200);
  assert.equal((await call('DELETE', '/api/entries/' + id)).status, 404);
  assert.equal((await call('GET', '/api/entries')).data.length, 0);
});

test('validação rejeita dados inválidos', async () => {
  assert.equal((await call('POST', '/api/entries', { type: 'livro', title: 'x' })).status, 400);
  assert.equal((await call('POST', '/api/entries', { type: 'movie', title: '  ' })).status, 400);
  assert.equal((await call('POST', '/api/entries', { type: 'movie', title: 'x', date: '01/02/2026' })).status, 400);
  const clamp = await call('POST', '/api/entries', { type: 'movie', title: 'Nota', rating: 99 });
  assert.equal(clamp.data.rating, 5);
  await call('DELETE', '/api/entries/' + clamp.data.id);
  const halfStar = await call('POST', '/api/entries', { type: 'movie', title: 'Meia', rating: 3.5 });
  assert.equal(halfStar.data.rating, 3.5);
  assert.equal((await call('GET', '/api/entries/' + halfStar.data.id)).data.rating, 3.5);
  const odd = await call('POST', '/api/entries', { type: 'movie', title: 'Quebrada', rating: 3.8 });
  assert.equal(odd.data.rating, 4);
  await call('DELETE', '/api/entries/' + halfStar.data.id);
  await call('DELETE', '/api/entries/' + odd.data.id);
});

test('capa: envia imagem, serve com login, rejeita não-imagem e remove', async () => {
  const e = (await call('POST', '/api/entries', { type: 'game', title: 'Jogo com capa' })).data;
  const bad = await call('PUT', '/api/entries/' + e.id + '/cover', Buffer.from('<script>alert(1)</script>'), { 'content-type': 'image/png' });
  assert.equal(bad.status, 415);

  const ok = await call('PUT', '/api/entries/' + e.id + '/cover', PNG, { 'content-type': 'image/png' });
  assert.equal(ok.status, 200);
  assert.match(ok.data.coverUrl, /^\/covers\/.+\.png\?v=\d+$/);

  const img = await fetch(base + ok.data.coverUrl, { headers: { cookie } });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  const anon = await fetch(base + ok.data.coverUrl);
  assert.equal(anon.status, 401);

  const file = path.join(dir, 'covers', ok.data.coverId);
  assert.ok(fs.existsSync(file));
  const cleared = await call('DELETE', '/api/entries/' + e.id + '/cover');
  assert.equal(cleared.data.coverUrl, null);
  assert.ok(!fs.existsSync(file));
  await call('DELETE', '/api/entries/' + e.id);
});

test('não permite sair da pasta de capas (path traversal)', async () => {
  const r = await fetch(base + '/covers/..%2F..%2Fmeu-arquivo.db', { headers: { cookie } });
  assert.equal(r.status, 404);
});

test('exportar e importar (com capas) restaura os dados', async () => {
  const a = (await call('POST', '/api/entries', { type: 'series', title: 'Série A', status: 'Completa', episodes: 8, extra: '2' })).data;
  await call('PUT', '/api/entries/' + a.id + '/cover', PNG, { 'content-type': 'image/png' });
  const backup = (await call('GET', '/api/export?covers=1')).data;
  assert.equal(backup.length, 1);
  assert.match(backup[0].coverData, /^data:image\/png;base64,/);

  await call('DELETE', '/api/entries/' + a.id);
  const imp = await call('POST', '/api/import', backup);
  assert.deepEqual(imp.data, { created: 1, updated: 0, skipped: 0 });
  const again = await call('POST', '/api/import', backup);
  assert.deepEqual(again.data, { created: 0, updated: 1, skipped: 0 });

  const restored = (await call('GET', '/api/entries')).data[0];
  assert.equal(restored.id, a.id);
  assert.equal(restored.title, 'Série A');
  assert.ok(restored.coverUrl);
  await call('DELETE', '/api/entries/' + a.id);
});

test('requisição de outra origem é bloqueada (CSRF)', async () => {
  const r = await call('POST', '/api/entries', { type: 'movie', title: 'Invasor' }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  assert.equal((await call('GET', '/api/entries')).data.length, 0);
});

test('logout limpa o cookie', async () => {
  const r = await call('POST', '/api/logout');
  assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
});

test('limite de tentativas de login (5 falhas bloqueiam)', async () => {
  cookie = null;
  let last;
  for (let i = 0; i < 6; i++) last = await call('POST', '/api/login', { username: 'eu', password: 'errada' + i });
  assert.equal(last.status, 429);
  // mesmo com a senha certa, o IP segue bloqueado por 15 min
  assert.equal((await call('POST', '/api/login', { username: 'eu', password: 'senha-longa-123' })).status, 429);
});

test('fundo da imagem de compartilhamento: envia, serve só com login e remove', async () => {
  // o teste anterior esgotou o limite de login do IP; usa outro app isolado
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-bg-'));
  const app = createApp(loadConfig({ DATA_DIR: dir2, APP_USERNAME: 'eu', APP_PASSWORD: 'senha-longa-123', AUTO_SEED: '0' }));
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const b = 'http://127.0.0.1:' + app.server.address().port;
  const lg = await fetch(b + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'eu', password: 'senha-longa-123' }) });
  const ck = lg.headers.get('set-cookie').split(';')[0];
  try {
    assert.equal((await (await fetch(b + '/api/me', { headers: { cookie: ck } })).json()).shareBg, null);
    assert.equal((await fetch(b + '/share-bg', { headers: { cookie: ck } })).status, 404);

    const bad = await fetch(b + '/api/share-bg', { method: 'PUT', headers: { cookie: ck }, body: Buffer.from('não sou imagem') });
    assert.equal(bad.status, 415);

    const ok = await fetch(b + '/api/share-bg', { method: 'PUT', headers: { cookie: ck }, body: PNG });
    assert.equal(ok.status, 200);
    const v = (await ok.json()).shareBg;
    assert.ok(v > 0);
    const img = await fetch(b + '/share-bg?v=' + v, { headers: { cookie: ck } });
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal((await fetch(b + '/share-bg', { redirect: 'manual' })).status, 302); // sem login vai para /login

    await fetch(b + '/api/share-bg', { method: 'DELETE', headers: { cookie: ck } });
    assert.equal((await fetch(b + '/share-bg', { headers: { cookie: ck } })).status, 404);
  } finally {
    await new Promise((r) => app.server.close(r));
    fs.rmSync(dir2, { recursive: true, force: true });
  }
});
