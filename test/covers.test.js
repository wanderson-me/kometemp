'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createApp, loadConfig } = require('../server');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
let tmdbSrv, tmdbBase, server, base, dir, cookie, tmdbCalls;

before(async () => {
  tmdbCalls = [];
  // TMDB simulado: tt0000001 tem pôster; tt0000002 não tem; tt0000003 é série; qualquer outro: não encontrado.
  tmdbSrv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    tmdbCalls.push(u.pathname + u.search);
    if (u.pathname.startsWith('/img/')) { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(JPEG); }
    if (u.searchParams.get('api_key') !== 'k'.repeat(32)) { res.writeHead(401); return res.end('{}'); }
    const id = u.pathname.split('/').pop();
    const out = { movie_results: [], tv_results: [] };
    if (id === 'tt0000001') out.movie_results.push({ poster_path: '/a.jpg' });
    if (id === 'tt0000002') out.movie_results.push({ poster_path: null });
    if (id === 'tt0000003') out.tv_results.push({ poster_path: '/s.jpg' });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });
  await new Promise((r) => tmdbSrv.listen(0, '127.0.0.1', r));
  tmdbBase = 'http://127.0.0.1:' + tmdbSrv.address().port;

  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-cov-'));
  const cfg = loadConfig({
    DATA_DIR: dir, APP_USERNAME: 'eu', APP_PASSWORD: 'senha-longa-123', AUTO_SEED: '0',
    TMDB_API_KEY: 'k'.repeat(32), TMDB_API_BASE: tmdbBase + '/3', TMDB_IMAGE_BASE: tmdbBase + '/img', TMDB_DELAY_MS: '0'
  });
  ({ server } = createApp(cfg));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'eu', password: 'senha-longa-123' }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
});
after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => tmdbSrv.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

async function api(method, url, body) {
  const res = await fetch(base + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
}

test('registro novo com IMDb ganha capa automaticamente', async () => {
  const r = await api('POST', '/api/entries', { type: 'movie', title: 'Com pôster', imdbUrl: 'https://www.imdb.com/pt/title/tt0000001/' });
  assert.equal(r.status, 201);
  assert.match(r.data.coverUrl, /^\/covers\//);
});

test('sem pôster no TMDB ou sem IMDb: salva normalmente, sem capa', async () => {
  const a = await api('POST', '/api/entries', { type: 'movie', title: 'Sem pôster', imdbUrl: 'tt0000002' });
  assert.equal(a.data.coverUrl, null);
  const b = await api('POST', '/api/entries', { type: 'movie', title: 'Sem IMDb' });
  assert.equal(b.data.coverUrl, null);
  const g = await api('POST', '/api/entries', { type: 'game', title: 'Jogo', imdbUrl: 'tt0000001' });
  assert.equal(g.data.coverUrl, null);
});

test('busca em lote preenche só o que falta e informa o resultado', async () => {
  await api('POST', '/api/entries', { type: 'series', title: 'Série', imdbUrl: 'https://www.imdb.com/title/tt0000003/' }); // já ganha capa
  // cria itens "sem capa" simulando cadastros antigos: troca a chave do mock criando via import (sem passar pelo autoCover)
  const imp = await fetch(base + '/api/import', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify([
    { id: 'old1', type: 'movie', title: 'Antigo 1', imdbUrl: 'https://www.imdb.com/title/tt0000001/' },
    { id: 'old2', type: 'movie', title: 'Antigo 2', imdbUrl: 'https://www.imdb.com/title/tt0000002/' },
    { id: 'old3', type: 'movie', title: 'Antigo 3', imdbUrl: 'https://www.imdb.com/title/tt9999999/' }
  ]) });
  assert.equal(imp.status, 200);
  const start = await api('POST', '/api/covers/sync');
  assert.equal(start.status, 202);
  let st;
  for (let i = 0; i < 50; i++) {
    st = (await api('GET', '/api/covers/sync')).data;
    if (!st.running) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(st.running, false);
  assert.equal(st.error, null);
  assert.ok(st.found >= 1);
  const list = (await api('GET', '/api/entries')).data;
  assert.ok(list.find((e) => e.id === 'old1').coverUrl);
  assert.equal(list.find((e) => e.id === 'old2').coverUrl, null);
  assert.equal(list.find((e) => e.id === 'old3').coverUrl, null);
});

test('/api/me informa que a busca de capas está ativa', async () => {
  assert.equal((await api('GET', '/api/me')).data.covers, true);
});

test('chave recusada pelo TMDB interrompe o lote com mensagem clara', async () => {
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-cov2-'));
  const cfg = loadConfig({ DATA_DIR: dir2, APP_USERNAME: 'eu', APP_PASSWORD: 'senha-longa-123', AUTO_SEED: '0',
    TMDB_API_KEY: 'x'.repeat(32), TMDB_API_BASE: tmdbBase + '/3', TMDB_IMAGE_BASE: tmdbBase + '/img', TMDB_DELAY_MS: '0' });
  const app = createApp(cfg);
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const b = 'http://127.0.0.1:' + app.server.address().port;
  const lg = await fetch(b + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'eu', password: 'senha-longa-123' }) });
  const ck = lg.headers.get('set-cookie').split(';')[0];
  const h = { cookie: ck, 'content-type': 'application/json' };
  await fetch(b + '/api/import', { method: 'POST', headers: h, body: JSON.stringify([{ id: 'z1', type: 'movie', title: 'Z', imdbUrl: 'tt0000001' }]) });
  await fetch(b + '/api/covers/sync', { method: 'POST', headers: h });
  let st;
  for (let i = 0; i < 50; i++) { st = await (await fetch(b + '/api/covers/sync', { headers: h })).json(); if (!st.running) break; await new Promise((r) => setTimeout(r, 50)); }
  assert.match(st.error, /Chave do TMDB/);
  await new Promise((r) => app.server.close(r));
  fs.rmSync(dir2, { recursive: true, force: true });
});

test('sem TMDB_API_KEY a busca fica desativada (503) e o app segue normal', async () => {
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-cov3-'));
  const app = createApp(loadConfig({ DATA_DIR: dir3, APP_USERNAME: 'eu', APP_PASSWORD: 'senha-longa-123', AUTO_SEED: '0' }));
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const b = 'http://127.0.0.1:' + app.server.address().port;
  const lg = await fetch(b + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'eu', password: 'senha-longa-123' }) });
  const h = { cookie: lg.headers.get('set-cookie').split(';')[0], 'content-type': 'application/json' };
  assert.equal((await fetch(b + '/api/covers/sync', { method: 'POST', headers: h })).status, 503);
  assert.equal((await (await fetch(b + '/api/me', { headers: h })).json()).covers, false);
  const c = await fetch(b + '/api/entries', { method: 'POST', headers: h, body: JSON.stringify({ type: 'movie', title: 'X', imdbUrl: 'tt0000001' }) });
  assert.equal(c.status, 201);
  await new Promise((r) => app.server.close(r));
  fs.rmSync(dir3, { recursive: true, force: true });
});
