'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const db = require('../lib/db');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ma-rate-')); }

test('importação de backup antigo (nota em estrelas 0-5) dobra a nota; backup novo (ratingScale 10) não mexe', () => {
  const dir = tmp();
  const store = db.open(dir);
  try {
    const res = store.importMany([
      { id: 'old00001', type: 'movie', title: 'Antigo 4 estrelas', rating: 4 },
      { id: 'old00002', type: 'movie', title: 'Antigo meia estrela', rating: 3.5 },
      { id: 'old00003', type: 'movie', title: 'Antigo sem nota', rating: 0 },
      { id: 'new00001', type: 'movie', title: 'Novo nota 7', rating: 7, ratingScale: 10 }
    ]);
    assert.equal(res.created, 4);
    const r = (id) => store.get(id).rating;
    assert.equal(r('old00001'), 8);
    assert.equal(r('old00002'), 7);
    assert.equal(r('old00003'), 0);
    assert.equal(r('new00001'), 7);

    const exported = store.exportAll(false);
    assert.ok(exported.every((e) => e.ratingScale === 10));
    // exportar e importar de novo não altera as notas
    store.importMany(exported);
    assert.equal(r('old00001'), 8);
    assert.equal(r('new00001'), 7);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('banco antigo (notas em estrelas) é migrado uma única vez para 1-10 ao abrir', () => {
  const dir = tmp();
  try {
    const s1 = db.open(dir); s1.close();                      // cria o esquema
    const raw = new DatabaseSync(path.join(dir, 'meu-arquivo.db'));
    const ins = raw.prepare("INSERT INTO entries (id,type,title,rating,created_at,updated_at) VALUES (?,?,?,?,1,1)");
    ins.run('m0000001', 'movie', 'Quatro', 4);
    ins.run('m0000002', 'movie', 'Três e meia', 3.5);
    ins.run('m0000003', 'series', 'Sem nota', 0);
    raw.exec('PRAGMA user_version = 0');                      // como um banco da versão anterior
    raw.close();

    const s2 = db.open(dir);
    assert.equal(s2.get('m0000001').rating, 8);
    assert.equal(s2.get('m0000002').rating, 7);
    assert.equal(s2.get('m0000003').rating, 0);
    s2.close();

    const s3 = db.open(dir);                                  // abrir de novo não dobra outra vez
    assert.equal(s3.get('m0000001').rating, 8);
    assert.equal(s3.get('m0000002').rating, 7);
    s3.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
