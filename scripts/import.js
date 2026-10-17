'use strict';
// Importa registros (formato do seed ou de um backup exportado) para o banco local.
// Uso: node scripts/import.js caminho/do/arquivo.json   (usa DATA_DIR, padrão ./data)
const fs = require('node:fs');
const path = require('node:path');
const db = require('../lib/db');

const file = process.argv[2];
if (!file) { console.error('Uso: node scripts/import.js arquivo.json'); process.exit(1); }
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const items = JSON.parse(fs.readFileSync(file, 'utf8'));
const covers = path.join(path.dirname(path.resolve(file)), 'covers');
const store = db.open(dataDir);
const res = store.importMany(items, {
  coverResolver(e) {
    const f = e.id && ['jpg', 'png', 'webp', 'gif'].map((x) => path.join(covers, e.id + '.' + x)).find((p) => fs.existsSync(p));
    return f ? fs.readFileSync(f) : null;
  }
});
console.log(JSON.stringify(res), '— total no banco:', store.count());
store.close();
