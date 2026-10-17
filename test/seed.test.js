'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const db = require('../lib/db');

test('seed/entries.json importa tudo, com as 3 capas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-seed-'));
  const store = db.open(dir);
  const items = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'entries.json'), 'utf8'));
  const covers = path.join(__dirname, '..', 'seed', 'covers');
  const res = store.importMany(items, {
    coverResolver(e) {
      const f = ['jpg', 'png', 'webp'].map((x) => path.join(covers, e.id + '.' + x)).find((p) => fs.existsSync(p));
      return f ? fs.readFileSync(f) : null;
    }
  });
  assert.equal(res.skipped, 0);
  assert.equal(res.created, items.length);
  assert.equal(store.count(), items.length);
  assert.equal(store.list().filter((e) => e.coverUrl).length, 3);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
