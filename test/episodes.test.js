'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createApp, loadConfig } = require('../server');
const { buildEpisodes } = require('../lib/imdb');

// CSV no formato do IMDb em português: séries, episódios avulsos e uma série que não está no arquivo.
const CSV = [
  'Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors',
  'tt9000001,9,2026-01-01,Dr. House,House M.D.,https://www.imdb.com/title/tt9000001,Série de TV,8.7,44,2004,Drama,1,2004-11-16,',
  'tt9000002,8,2026-01-01,Sobrenatural,Supernatural,https://www.imdb.com/title/tt9000002,Série de TV,8.4,44,2005,Fantasia,1,2005-09-13,',
  'tt9100001,8,2026-01-02,"Dr. House: Pilot","House M.D.: Pilot",https://www.imdb.com/title/tt9100001,Episódio de TV,8,44,2004,Drama,1,2004-11-16,',
  'tt9100002,8,2026-01-02,"Dr. House: Everybody Dies","House M.D.: Everybody Dies",https://www.imdb.com/title/tt9100002,Episódio de TV,9,46,2012,Drama,1,2012-05-21,',
  'tt9100003,7,2026-01-02,"Dr. House: Pilot","House M.D.: Pilot",https://www.imdb.com/title/tt9100003,Episódio de TV,9,,2005,Drama,1,2005-01-01,',
  'tt9100004,7,2026-01-03,"Supernatural: Pilot","Supernatural: Pilot",https://www.imdb.com/title/tt9100004,Episódio de TV,9,42,2005,Drama,1,2005-09-13,',
  'tt9100005,7,2026-01-03,"Ozark: Sugarwood","Ozark: Sugarwood",https://www.imdb.com/title/tt9100005,Episódio de TV,9,60,2017,Drama,1,2017-07-21,'
].join('\n');

test('buildEpisodes casa episódios com a série pelo nome e lista as que não estão no catálogo', () => {
  const entries = [
    { id: 'a1', type: 'series', title: 'Dr. House', imdbUrl: 'https://www.imdb.com/title/tt9000001/' },
    { id: 'a2', type: 'series', title: 'Supernatural', imdbUrl: '' },
    { id: 'm1', type: 'movie', title: 'Dr. House', imdbUrl: '' }
  ];
  const r = buildEpisodes(CSV, entries);
  assert.equal(r.matched, 4);
  assert.equal(r.series, 2);
  assert.deepEqual(r.unmatched, [{ title: 'Ozark', count: 1 }]);
  const house = r.groups.find((g) => g.entryId === 'a1');
  assert.deepEqual(house.eps.map((e) => e.tt), ['tt9100001', 'tt9100002', 'tt9100003']);
  assert.deepEqual(house.eps.map((e) => e.minutes), [44, 46, 0]);
  assert.equal(r.groups.find((g) => g.entryId === 'a2').eps.length, 1); // casou pelo nome, sem link do IMDb
});

let tmdbSrv, server, base, dir, cookie;

before(async () => {
  // TMDB simulado: episódios tt9100001/2 são da temporada 1 e 8; tt9100003 temporada 1; tt9100004 não existe.
  tmdbSrv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    res.writeHead(200, { 'content-type': 'application/json' });
    const id = u.pathname.split('/').pop();
    if (u.pathname.startsWith('/3/find/')) {
      const seasons = { tt9100001: 1, tt9100002: 8, tt9100003: 1 };
      return res.end(JSON.stringify({ movie_results: [], tv_results: [], tv_episode_results: seasons[id] ? [{ show_id: 1408, season_number: seasons[id], episode_number: 1 }] : [] }));
    }
    if (u.pathname === '/3/tv/1408') {
      return res.end(JSON.stringify({ number_of_seasons: 9, number_of_episodes: 180, seasons: [
        { season_number: 0, episode_count: 5 }, ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ season_number: n, episode_count: 22 }))] }));
    }
    res.end('{}');
  });
  await new Promise((r) => tmdbSrv.listen(0, '127.0.0.1', r));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-ep-'));
  const cfg = loadConfig({
    DATA_DIR: dir, APP_USERNAME: 'eu', APP_PASSWORD: 'senha-longa-123', AUTO_SEED: '0',
    TMDB_API_KEY: 'k'.repeat(32), TMDB_API_BASE: 'http://127.0.0.1:' + tmdbSrv.address().port + '/3', TMDB_DELAY_MS: '0'
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

async function api(method, url, body, raw) {
  const res = await fetch(base + url, { method, headers: { cookie, 'content-type': raw ? 'text/csv' : 'application/json' }, body: raw ? body : (body ? JSON.stringify(body) : undefined) });
  return { status: res.status, data: await res.json() };
}
async function waitSync() {
  for (let i = 0; i < 100; i++) {
    const s = await api('GET', '/api/episodes/sync');
    if (!s.data.running) return s.data;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('a busca de temporadas não terminou');
}

test('importar o CSV soma episódios e tempo; o TMDB preenche temporadas e status', async () => {
  const r = await api('POST', '/api/import/imdb', CSV, true);
  assert.equal(r.status, 200);
  assert.equal(r.data.series, 2);
  assert.equal(r.data.episodesMatched, 4);
  assert.equal(r.data.episodesSeries, 2);
  assert.deepEqual(r.data.episodesUnmatched, [{ title: 'Ozark', count: 1 }]);

  const st = await waitSync();
  assert.equal(st.error, null);
  assert.equal(st.total, 4);

  const list = (await api('GET', '/api/entries')).data;
  const house = list.find((e) => e.title === 'Dr. House');
  assert.equal(house.episodes, 3);
  assert.equal(house.duration, 90);       // 44 + 46 + 0
  assert.equal(house.extra, '2 de 8');    // temporadas 1 e 8 vistas, 8 no total (sem especiais)
  assert.equal(house.status, 'Assistindo'); // 3 de 176 episódios
  const sn = list.find((e) => e.title === 'Sobrenatural');
  assert.equal(sn.episodes, 1);
  assert.equal(sn.duration, 42);
  assert.equal(sn.extra, '');             // o TMDB não conhece o episódio: nada inventado
});

test('importar de novo não duplica nem apaga o que o usuário digitou', async () => {
  const house = (await api('GET', '/api/entries')).data.find((e) => e.title === 'Dr. House');
  await api('PUT', '/api/entries/' + house.id, Object.assign({}, house, { episodes: 177, extra: 'Todas', status: 'Completa' }));
  await api('POST', '/api/import/imdb', CSV, true);
  await waitSync();
  const again = (await api('GET', '/api/entries')).data.find((e) => e.title === 'Dr. House');
  assert.equal(again.episodes, 177);  // mantém o maior
  assert.equal(again.extra, 'Todas'); // texto próprio não é sobrescrito
  assert.equal(again.status, 'Completa');
  assert.equal((await api('GET', '/api/entries')).data.filter((e) => e.type === 'series').length, 2);
});
