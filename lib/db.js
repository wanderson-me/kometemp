'use strict';
// Camada de dados: SQLite (node:sqlite, embutido no Node >= 22.13) + capas em arquivos.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const TYPES = ['game', 'movie', 'series'];

const COVER_TYPES = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'gif', mime: 'image/gif', test: (b) => b.slice(0, 4).toString('latin1') === 'GIF8' },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP' }
];
const MIME_BY_EXT = Object.fromEntries(COVER_TYPES.map((t) => [t.ext, t.mime]));

function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  return COVER_TYPES.find((t) => t.test(buf)) || null;
}

function newId() {
  return 'e' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function str(v, max) {
  if (v == null) return '';
  return String(v).trim().slice(0, max);
}
function int(v, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(min, n));
}

// Nota de 1 a 10, como no IMDb (0 = sem nota).
function rate(v) {
  const n = parseFloat(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return Math.min(10, Math.max(0, Math.round(n)));
}

// Valida e normaliza um registro vindo do cliente. Lança Error com .status = 400.
function sanitize(input) {
  const bad = (msg) => { const e = new Error(msg); e.status = 400; throw e; };
  if (!input || typeof input !== 'object' || Array.isArray(input)) bad('Registro inválido.');
  const type = String(input.type || '');
  if (!TYPES.includes(type)) bad('Tipo inválido.');
  const title = str(input.title, 300);
  if (!title) bad('Informe um título.');
  let date = str(input.date, 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) bad('Data inválida.');
  let genres = [];
  if (Array.isArray(input.genres)) {
    genres = input.genres.map((g) => str(g, 60)).filter(Boolean).slice(0, 20);
  }
  return {
    type,
    title,
    date,
    rating: rate(input.rating),
    notes: str(input.notes, 5000),
    year: str(input.year, 10),
    duration: int(input.duration, 0, 10000000),
    genres,
    imdbUrl: str(input.imdbUrl, 500),
    platform: str(input.platform, 100),
    status: str(input.status, 40),
    extra: str(input.extra, 100),
    episodes: int(input.episodes, 0, 100000)
  };
}

function open(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'covers'), { recursive: true });
  const coversDir = path.join(dataDir, 'covers');
  const db = new DatabaseSync(path.join(dataDir, 'meu-arquivo.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL CHECK (type IN ('game','movie','series')),
      title      TEXT NOT NULL,
      date       TEXT NOT NULL DEFAULT '',
      rating     INTEGER NOT NULL DEFAULT 0,
      notes      TEXT NOT NULL DEFAULT '',
      year       TEXT NOT NULL DEFAULT '',
      duration   INTEGER NOT NULL DEFAULT 0,
      genres     TEXT NOT NULL DEFAULT '[]',
      imdb_url   TEXT NOT NULL DEFAULT '',
      platform   TEXT NOT NULL DEFAULT '',
      status     TEXT NOT NULL DEFAULT '',
      extra      TEXT NOT NULL DEFAULT '',
      episodes   INTEGER NOT NULL DEFAULT 0,
      cover      TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);
  `);

  // Migração 1: as notas antigas eram estrelas (0-5, com meia estrela); agora são de 1 a 10.
  const ver = db.prepare('PRAGMA user_version').get().user_version;
  if (ver < 1) {
    db.exec('BEGIN');
    db.exec('UPDATE entries SET rating = MIN(10, MAX(0, CAST(ROUND(rating * 2) AS INTEGER)))');
    db.exec('PRAGMA user_version = 1');
    db.exec('COMMIT');
  }

  const q = {
    all: db.prepare('SELECT * FROM entries ORDER BY created_at DESC'),
    one: db.prepare('SELECT * FROM entries WHERE id = ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM entries'),
    insert: db.prepare(`INSERT INTO entries
      (id,type,title,date,rating,notes,year,duration,genres,imdb_url,platform,status,extra,episodes,cover,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    update: db.prepare(`UPDATE entries SET
      type=?,title=?,date=?,rating=?,notes=?,year=?,duration=?,genres=?,imdb_url=?,platform=?,status=?,extra=?,episodes=?,updated_at=?
      WHERE id=?`),
    setCover: db.prepare('UPDATE entries SET cover=?, updated_at=? WHERE id=?'),
    del: db.prepare('DELETE FROM entries WHERE id = ?')
  };

  function toApi(r) {
    const e = {
      id: r.id,
      type: r.type,
      title: r.title,
      date: r.date,
      rating: r.rating,
      notes: r.notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      imdbUrl: r.imdb_url,
      coverId: r.cover || null,
      coverUrl: r.cover ? '/covers/' + r.cover + '?v=' + r.updated_at : null
    };
    if (r.type === 'game') {
      e.platform = r.platform; e.status = r.status;
    } else if (r.type === 'movie') {
      e.year = r.year; e.duration = r.duration; e.genres = JSON.parse(r.genres || '[]');
    } else {
      e.extra = r.extra; e.status = r.status; e.episodes = r.episodes; e.duration = r.duration;
    }
    return e;
  }

  function list() { return q.all.all().map(toApi); }
  function get(id) { const r = q.one.get(id); return r ? toApi(r) : null; }
  function count() { return q.count.get().n; }

  function insertRow(id, v, cover, createdAt, updatedAt) {
    q.insert.run(id, v.type, v.title, v.date, v.rating, v.notes, v.year, v.duration,
      JSON.stringify(v.genres), v.imdbUrl, v.platform, v.status, v.extra, v.episodes,
      cover || null, createdAt, updatedAt);
  }

  function create(input) {
    const v = sanitize(input);
    const now = Date.now();
    const id = newId();
    insertRow(id, v, null, now, now);
    return get(id);
  }

  function update(id, input) {
    if (!q.one.get(id)) return null;
    const v = sanitize(input);
    q.update.run(v.type, v.title, v.date, v.rating, v.notes, v.year, v.duration, JSON.stringify(v.genres),
      v.imdbUrl, v.platform, v.status, v.extra, v.episodes, Date.now(), id);
    return get(id);
  }

  function removeCoverFile(name) {
    if (!name) return;
    try { fs.unlinkSync(path.join(coversDir, path.basename(name))); } catch (_) { /* já removido */ }
  }

  function remove(id) {
    const r = q.one.get(id);
    if (!r) return false;
    q.del.run(id);
    removeCoverFile(r.cover);
    return true;
  }

  function setCover(id, buf) {
    const r = q.one.get(id);
    if (!r) return null;
    const kind = sniffImage(buf);
    if (!kind) { const e = new Error('Envie uma imagem JPG, PNG, WEBP ou GIF.'); e.status = 415; throw e; }
    const name = id + '-' + crypto.randomBytes(4).toString('hex') + '.' + kind.ext;
    fs.writeFileSync(path.join(coversDir, name), buf);
    q.setCover.run(name, Date.now(), id);
    removeCoverFile(r.cover);
    return get(id);
  }

  function clearCover(id) {
    const r = q.one.get(id);
    if (!r) return null;
    q.setCover.run(null, Date.now(), id);
    removeCoverFile(r.cover);
    return get(id);
  }

  function coverFile(name) {
    const base = path.basename(String(name || ''));
    if (!/^[A-Za-z0-9._-]+$/.test(base)) return null;
    const file = path.join(coversDir, base);
    if (!fs.existsSync(file)) return null;
    const ext = base.split('.').pop().toLowerCase();
    return { file, mime: MIME_BY_EXT[ext] || 'application/octet-stream' };
  }

  // Exporta tudo. Com covers=true embute as capas como data URL (backup completo).
  function exportAll(covers) {
    return q.all.all().map((r) => {
      const e = toApi(r);
      delete e.coverUrl;
      e.ratingScale = 10;
      if (covers && r.cover) {
        const f = coverFile(r.cover);
        if (f) e.coverData = 'data:' + f.mime + ';base64,' + fs.readFileSync(f.file).toString('base64');
      }
      return e;
    });
  }

  // Importa uma lista de registros (formato do export ou do seed). Atualiza por id, cria o que falta.
  // `coverResolver(entry)` (opcional) pode devolver um Buffer de capa para registros sem coverData.
  function importMany(items, opts) {
    opts = opts || {};
    if (!Array.isArray(items)) { const e = new Error('O arquivo deve conter uma lista de registros.'); e.status = 400; throw e; }
    let created = 0, updated = 0, skipped = 0;
    db.exec('BEGIN');
    try {
      for (const raw of items) {
        let v;
        try {
          // Backups e seeds antigos têm nota em estrelas (0-5): sem a marca ratingScale=10, dobra.
          const current = opts.ratingScale === 10 || (raw && raw.ratingScale === 10);
          v = sanitize(current || !raw || typeof raw !== 'object' ? raw : Object.assign({}, raw, { rating: (parseFloat(raw.rating) || 0) * 2 }));
        } catch (_) { skipped++; continue; }
        const id = /^[A-Za-z0-9_-]{3,40}$/.test(String(raw.id || '')) ? String(raw.id) : newId();
        const createdAt = Number.isFinite(+raw.createdAt) && +raw.createdAt > 0 ? +raw.createdAt : Date.now();
        const exists = q.one.get(id);
        if (exists) {
          q.update.run(v.type, v.title, v.date, v.rating, v.notes, v.year, v.duration, JSON.stringify(v.genres),
            v.imdbUrl, v.platform, v.status, v.extra, v.episodes, Date.now(), id);
          updated++;
        } else {
          insertRow(id, v, null, createdAt, createdAt);
          created++;
        }
        let buf = null;
        if (typeof raw.coverData === 'string') {
          const m = raw.coverData.match(/^data:image\/[a-z+]+;base64,(.+)$/);
          if (m) buf = Buffer.from(m[1], 'base64');
        } else if (opts.coverResolver) {
          buf = opts.coverResolver(raw) || null;
        }
        if (buf && sniffImage(buf)) setCover(id, buf);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return { created, updated, skipped };
  }

  function close() { db.close(); }

  return { list, get, count, create, update, remove, setCover, clearCover, coverFile, exportAll, importMany, close, sniffImage };
}

module.exports = { open, sanitize, sniffImage, TYPES };
