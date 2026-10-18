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
    const det = u.pathname.match(/\/(movie|tv)\/(\d+)$/);
    if (det) {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (det[1] === 'movie' && det[2] === '101') {
        return res.end(JSON.stringify({
          title: 'Filme Um', original_title: 'Movie One', tagline: 'Uma frase.', overview: 'Sinopse em português.', release_date: '1999-03-31', runtime: 136,
          genres: [{ name: 'Ação' }, { name: 'Ficção científica' }], vote_average: 8.236,
          credits: { cast: [{ name: 'Ator Um', character: 'Herói' }, { name: 'Atriz Dois', character: 'Vilã' }], crew: [{ job: 'Producer', name: 'Não é diretor' }, { job: 'Director', name: 'Diretor Um' }] },
          'watch/providers': { results: { BR: { link: 'https://www.themoviedb.org/movie/101/watch?locale=BR', flatrate: [{ provider_name: 'Netflix' }], rent: [{ provider_name: 'Apple TV' }] }, US: { flatrate: [{ provider_name: 'Hulu' }] } } }
        }));
      }
      if (det[1] === 'tv' && det[2] === '303') {
        const pt = u.searchParams.get('language') === 'pt-BR';
        return res.end(JSON.stringify({ name: 'Série Três', overview: pt ? '' : 'English overview.', tagline: '', first_air_date: '2010-01-01', number_of_seasons: 3, number_of_episodes: 30,
          created_by: [{ name: 'Criador Um' }], genres: [{ name: 'Drama' }], credits: { cast: [{ name: 'Ator Três', character: '' }] }, 'watch/providers': { results: {} } }));
      }
      res.writeHead(404); return res.end('{}');
    }
    const id = u.pathname.split('/').pop();
    const out = { movie_results: [], tv_results: [] };
    if (id === 'tt0000001') out.movie_results.push({ id: 101, poster_path: '/a.jpg' });
    if (id === 'tt0000002') out.movie_results.push({ id: 102, poster_path: null });
    if (id === 'tt0000003') out.tv_results.push({ id: 303, poster_path: '/s.jpg' });
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


test('detalhes: sinopse, direção, elenco e onde assistir (só Brasil), com cache', async () => {
  const c = await api('POST', '/api/entries', { type: 'movie', title: 'Meu filme', imdbUrl: 'https://www.imdb.com/title/tt0000001/' });
  const before = tmdbCalls.filter((x) => x.includes('/movie/101')).length;
  const r = await api('GET', '/api/entries/' + c.data.id + '/details');
  assert.equal(r.status, 200);
  assert.equal(r.data.kind, 'movie');
  assert.equal(r.data.overview, 'Sinopse em português.');
  assert.equal(r.data.tagline, 'Uma frase.');
  assert.deepEqual(r.data.directors, ['Diretor Um']);
  assert.equal(r.data.cast[0].name, 'Ator Um');
  assert.equal(r.data.cast[0].character, 'Herói');
  assert.equal(r.data.runtime, 136);
  assert.equal(r.data.voteAverage, 8.2);
  assert.deepEqual(r.data.genres, ['Ação', 'Ficção científica']);
  assert.deepEqual(r.data.providers.flatrate, ['Netflix']);   // US/Hulu fica de fora
  assert.deepEqual(r.data.providers.rent, ['Apple TV']);
  assert.equal(r.data.tmdbUrl, 'https://www.themoviedb.org/movie/101');
  assert.equal(tmdbCalls.filter((x) => x.includes('/movie/101')).length, before + 1);
  const again = await api('GET', '/api/entries/' + c.data.id + '/details');   // segunda vez vem do cache
  assert.equal(again.status, 200);
  assert.equal(again.data.overview, 'Sinopse em português.');
  assert.equal(tmdbCalls.filter((x) => x.includes('/movie/101')).length, before + 1);
});

test('detalhes de série: criação, temporadas e sinopse em inglês quando falta em português', async () => {
  const c = await api('POST', '/api/entries', { type: 'series', title: 'Minha série', imdbUrl: 'tt0000003' });
  const r = await api('GET', '/api/entries/' + c.data.id + '/details');
  assert.equal(r.status, 200);
  assert.equal(r.data.kind, 'tv');
  assert.equal(r.data.overview, 'English overview.');
  assert.deepEqual(r.data.directors, ['Criador Um']);
  assert.equal(r.data.seasons, 3);
  assert.equal(r.data.episodes, 30);
  assert.equal(r.data.providers, null);
});

test('detalhes: erros claros (sem IMDb, não encontrado, registro inexistente)', async () => {
  const a = await api('POST', '/api/entries', { type: 'movie', title: 'Sem código' });
  const ra = await api('GET', '/api/entries/' + a.data.id + '/details');
  assert.equal(ra.status, 404);
  assert.match(ra.data.error, /código do IMDb/);
  const b = await api('POST', '/api/entries', { type: 'movie', title: 'Desconhecido', imdbUrl: 'tt9999998' });
  const rb = await api('GET', '/api/entries/' + b.data.id + '/details');
  assert.equal(rb.status, 404);
  assert.match(rb.data.error, /TMDB não encontrou/);
  assert.equal((await api('GET', '/api/entries/naoexiste/details')).status, 404);
  const anon = await fetch(base + '/api/entries/' + a.data.id + '/details');   // sem login
  assert.equal(anon.status, 401);
});
