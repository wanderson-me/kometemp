'use strict';
// Importação do CSV exportado pelo IMDb (avaliações ou listas).

// Parser CSV (RFC 4180): aspas, vírgulas e quebras de linha dentro de campos, BOM.
function parseCsv(text) {
  text = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

const GENRES = {
  'action': 'Ação', 'adventure': 'Aventura', 'animation': 'Animação', 'biography': 'Biografia', 'comedy': 'Comédia',
  'crime': 'Policial', 'documentary': 'Documentário', 'drama': 'Drama', 'family': 'Família', 'fantasy': 'Fantasia',
  'film-noir': 'Film noir', 'game-show': 'Game show', 'history': 'História', 'horror': 'Terror', 'music': 'Musical',
  'musical': 'Musical', 'mystery': 'Mistério', 'news': 'Notícias', 'reality-tv': 'Reality show', 'romance': 'Romance',
  'sci-fi': 'Ficção científica', 'short': 'Curta-metragem', 'sport': 'Esportes', 'talk-show': 'Talk show',
  'thriller': 'Suspense', 'war': 'Guerra', 'western': 'Faroeste'
};

function translateGenres(raw) {
  const out = [];
  String(raw || '').split(',').map((g) => g.trim()).filter(Boolean).forEach((g) => {
    const pt = GENRES[g.toLowerCase()] || g;
    if (!out.includes(pt)) out.push(pt);
  });
  return out;
}

function imdbId(s) {
  const m = String(s || '').match(/tt\d{6,10}/i);
  return m ? m[0].toLowerCase() : null;
}

function kindOf(titleType) {
  const t = String(titleType || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!t) return 'movie';
  if (t === 'tvseries' || t === 'tvminiseries') return 'series';
  if (['movie', 'tvmovie', 'short', 'tvshort', 'video', 'tvspecial'].includes(t)) return 'movie';
  return null; // episódios, jogos, podcasts etc. ficam de fora
}

// Converte o CSV em registros e mescla com os que já existem (casando pelo código tt).
// existing: lista da API (formato de lib/db.toApi). Devolve { items, summary }.
function buildImport(csvText, existing) {
  const rows = parseCsv(csvText);
  const summary = { rows: 0, movies: 0, series: 0, skippedType: 0, noId: 0, duplicates: 0 };
  if (rows.length < 2) return { items: [], summary };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const iConst = col('const'), iUrl = col('url'), iTitle = col('title'), iType = col('title type');
  const iRating = col('your rating'), iRuntime = col('runtime (mins)'), iYear = col('year'), iGenres = col('genres');
  if (iConst < 0 && iUrl < 0) {
    const e = new Error('Este não parece um CSV do IMDb (faltam as colunas Const/URL).'); e.status = 400; throw e;
  }
  if (iTitle < 0) { const e = new Error('O CSV precisa da coluna Title.'); e.status = 400; throw e; }

  const byImdb = new Map();
  (existing || []).forEach((e) => { const id = imdbId(e.imdbUrl); if (id && !byImdb.has(id)) byImdb.set(id, e); });

  const seen = new Set();
  const items = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (i) => (i >= 0 && i < cells.length ? cells[i].trim() : '');
    summary.rows++;
    const id = imdbId(get(iConst)) || imdbId(get(iUrl));
    if (!id) { summary.noId++; continue; }
    if (seen.has(id)) { summary.duplicates++; continue; }
    seen.add(id);
    const kind = kindOf(get(iType));
    if (!kind) { summary.skippedType++; continue; }

    const rating10 = parseFloat(get(iRating));
    const stars = Number.isFinite(rating10) && rating10 > 0 ? Math.min(5, Math.max(1, Math.round(rating10 / 2))) : 0;
    const runtime = parseInt(get(iRuntime), 10) || 0;
    const year = get(iYear);
    const genres = translateGenres(get(iGenres));
    const title = get(iTitle);
    const url = 'https://www.imdb.com/title/' + id + '/';

    const old = byImdb.get(id);
    if (old) {
      // Já existe: atualiza só nota, gêneros, duração (filmes) e ano (filmes). Mantém título, datas, notas e capa.
      const merged = Object.assign({}, old);
      if (stars) merged.rating = stars;
      if (genres.length) merged.genres = genres;
      if (kind === 'movie' && old.type === 'movie') {
        if (runtime) merged.duration = runtime;
        if (/^\d{4}$/.test(year)) merged.year = year;
      }
      items.push(merged);
    } else if (kind === 'movie') {
      items.push({ type: 'movie', title, rating: stars, year: /^\d{4}$/.test(year) ? year : '', duration: runtime, genres, imdbUrl: url });
    } else {
      items.push({ type: 'series', title, rating: stars, genres, imdbUrl: url });
    }
    if (kind === 'movie') summary.movies++; else summary.series++;
  }
  return { items, summary };
}

module.exports = { parseCsv, translateGenres, buildImport, imdbId };
