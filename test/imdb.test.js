'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseCsv, translateGenres, buildImport } = require('../lib/imdb');
const { createApp, loadConfig } = require('../server');

const HEADER = 'Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors';
const CSV = '﻿' + HEADER + '\r\n' + [
  'tt0111161,10,2022-01-01,Um Sonho de Liberdade,The Shawshank Redemption,https://www.imdb.com/title/tt0111161/,movie,9.3,142,1994,"Drama",3000000,1994-09-23,Frank Darabont',
  'tt0468569,9,2022-01-02,"Batman: O Cavaleiro das Trevas, o filme",The Dark Knight,https://www.imdb.com/title/tt0468569/,Movie,9.0,152,2008,"Action, Crime, Drama",3000000,2008-07-18,Christopher Nolan',
  'tt0903747,8,2022-01-03,Breaking Bad,Breaking Bad,https://www.imdb.com/title/tt0903747/,TV Series,9.5,49,2008,"Crime, Drama, Thriller",2000000,2008-01-20,',
  'tt0959621,7,2022-01-04,Episódio,Episode,https://www.imdb.com/title/tt0959621/,TV Episode,9.0,47,2008,"Drama",1000,2008-03-02,',
  'tt0111161,10,2022-01-05,Duplicado,Dup,https://www.imdb.com/title/tt0111161/,movie,9.3,142,1994,"Drama",3000000,1994-09-23,',
  ',5,2022-01-05,Sem id,Sem id,,movie,5,100,2000,"Drama",1,2000-01-01,',
  'tt1000001,1,2022-01-06,Filme Ruim,Bad Movie,https://www.imdb.com/title/tt1000001/,movie,2.0,90,2010,"Sci-Fi, Western, War",10,2010-01-01,'
].join('\n') + '\n';

test('parseCsv entende aspas, vírgulas internas, BOM e CRLF', () => {
  const rows = parseCsv(CSV);
  assert.equal(rows[0][0], 'Const');
  assert.equal(rows[2][3], 'Batman: O Cavaleiro das Trevas, o filme');
  assert.equal(rows[2][10], 'Action, Crime, Drama');
  assert.equal(rows.length, 8);
});

test('gêneros são traduzidos como no restante do catálogo', () => {
  assert.deepEqual(translateGenres('Action, Crime, Thriller, Sci-Fi'), ['Ação', 'Policial', 'Suspense', 'Ficção científica']);
  assert.deepEqual(translateGenres('Western, Estranho'), ['Faroeste', 'Estranho']);
});

test('buildImport: novos, existentes (casados pelo tt), ignorados e nota 1-10 -> 1-5', () => {
  const existing = [{ id: 'abc123', type: 'movie', title: 'Título que eu escolhi', date: '2024-05-01', rating: 3, notes: 'minha nota', year: '', duration: 0, genres: [], imdbUrl: 'https://www.imdb.com/pt/title/tt0111161/?ref_=x', coverId: 'c.jpg', coverUrl: '/covers/c.jpg', createdAt: 1 }];
  const { items, summary } = buildImport(CSV, existing);
  assert.deepEqual({ ...summary, skippedTypes: undefined }, { rows: 7, movies: 3, series: 1, skippedType: 1, skippedTypes: undefined, noId: 1, duplicates: 1 });
  assert.deepEqual({ ...summary.skippedTypes }, { 'TV Episode': 1 });
  assert.equal(items.length, 4);

  const old = items.find((i) => i.id === 'abc123');
  assert.equal(old.title, 'Título que eu escolhi');   // mantém o seu título
  assert.equal(old.notes, 'minha nota');
  assert.equal(old.date, '2024-05-01');
  assert.equal(old.rating, 5);                        // 10 -> 5
  assert.equal(old.duration, 142);
  assert.equal(old.year, '1994');
  assert.deepEqual(old.genres, ['Drama']);

  const bat = items.find((i) => i.imdbUrl.includes('tt0468569'));
  assert.equal(bat.rating, 4.5);                      // 9 -> 4,5
  assert.deepEqual(bat.genres, ['Ação', 'Policial', 'Drama']);
  assert.equal(bat.date, undefined);                  // não usa a data da avaliação

  const bb = items.find((i) => i.imdbUrl.includes('tt0903747'));
  assert.equal(bb.type, 'series');
  assert.equal(bb.rating, 4);                         // 8 -> 4
  assert.equal(bb.duration, undefined);               // séries não recebem duração do CSV

  assert.equal(items.find((i) => i.imdbUrl.includes('tt1000001')).rating, 0.5); // 1 -> 0,5
});

test('CSV que não é do IMDb é recusado com mensagem clara', () => {
  assert.throws(() => buildImport('a,b\n1,2\n', []), /não parece um CSV do IMDb/);
});

test('POST /api/import/imdb cria, depois atualiza sem duplicar', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-imdb-'));
  const app = createApp(loadConfig({ DATA_DIR: dir, APP_USERNAME: 'eu', APP_PASSWORD: 'senha-longa-123', AUTO_SEED: '0' }));
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const b = 'http://127.0.0.1:' + app.server.address().port;
  try {
    const lg = await fetch(b + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'eu', password: 'senha-longa-123' }) });
    const h = { cookie: lg.headers.get('set-cookie').split(';')[0] };
    const first = await (await fetch(b + '/api/import/imdb', { method: 'POST', headers: { ...h, 'content-type': 'text/csv' }, body: CSV })).json();
    assert.equal(first.created, 4);
    assert.equal(first.updated, 0);
    const second = await (await fetch(b + '/api/import/imdb', { method: 'POST', headers: { ...h, 'content-type': 'text/csv' }, body: CSV })).json();
    assert.equal(second.created, 0);
    assert.equal(second.updated, 4);
    const list = await (await fetch(b + '/api/entries', { headers: h })).json();
    assert.equal(list.length, 4);
    assert.equal(list.filter((e) => e.type === 'series').length, 1);

    const bad = await fetch(b + '/api/import/imdb', { method: 'POST', headers: { ...h, 'content-type': 'text/csv' }, body: 'x,y\n1,2\n' });
    assert.equal(bad.status, 400);
  } finally {
    await new Promise((r) => app.server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CSV com ponto e vírgula (Excel em português) também é lido; tipos ignorados são detalhados', () => {
  const csv = 'Const;Your Rating;Title;Title Type;Genres;Runtime (mins);Year\n' +
    'tt0000011;8;Filme A;movie;"Drama, Crime";100;2001\n' +
    'tt0000012;7;Ep;tvEpisode;Drama;40;2002\n' +
    'tt0000013;7;Jogo;videoGame;Action;;2003\n';
  const { items, summary } = buildImport(csv, []);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].genres, ['Drama', 'Policial']);
  assert.deepEqual({ ...summary.skippedTypes }, { tvEpisode: 1, videoGame: 1 });
});
