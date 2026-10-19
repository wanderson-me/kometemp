'use strict';
// Importação do CSV exportado pelo IMDb (avaliações ou listas).

// Parser CSV (RFC 4180): aspas, vírgulas e quebras de linha dentro de campos, BOM.
function parseCsv(text, delim) {
  text = String(text || '').replace(/^\uFEFF/, '');
  if (!delim) {
    const first = text.split(/\r?\n/, 1)[0] || '';
    delim = (first.split(';').length > first.split(',').length) ? ';' : ',';
  }
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ''; }
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
  const t = String(titleType || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
  if (!t) return 'movie';
  if (['tvseries', 'tvminiseries', 'serie', 'series', 'minisserie', 'miniserie', 'seriedetv', 'seriedetelevisao', 'minisseriedetv', 'minisseriedetelevisao'].includes(t)) return 'series';
  if (['movie', 'filme', 'tvmovie', 'short', 'curta', 'curtametragem', 'tvshort', 'video', 'tvspecial', 'filmedetv', 'filmedetelevisao', 'especialdetv', 'especialdetelevisao', 'curtadetv'].includes(t)) return 'movie';
  return null; // episódios, jogos, podcasts etc. ficam de fora
}

// Converte o CSV em registros e mescla com os que já existem (casando pelo código tt).
// existing: lista da API (formato de lib/db.toApi). Devolve { items, summary }.
function buildImport(csvText, existing) {
  const rows = parseCsv(csvText);
  const summary = { rows: 0, movies: 0, series: 0, skippedType: 0, skippedTypes: {}, noId: 0, duplicates: 0 };
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
    if (!kind) {
      summary.skippedType++;
      const tt = get(iType) || '(vazio)';
      summary.skippedTypes[tt] = (summary.skippedTypes[tt] || 0) + 1;
      continue;
    }

    const rating10 = parseFloat(get(iRating));
    const stars = Number.isFinite(rating10) && rating10 > 0 ? Math.min(10, Math.max(1, Math.round(rating10))) : 0;
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

// Notas de episódios soltos ("Série: Título do episódio") viram progresso da série correspondente:
// quantos episódios foram vistos e quanto tempo isso soma. Casa pelo nome (título ou título original)
// com as séries do catálogo, depois que a importação das séries já foi gravada.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

function buildEpisodes(csvText, entries) {
  const out = { groups: [], matched: 0, series: 0, unmatched: [] };
  const rows = parseCsv(csvText);
  if (rows.length < 2) return out;
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const iConst = col('const'), iUrl = col('url'), iTitle = col('title'), iOrig = col('original title');
  const iType = col('title type'), iRuntime = col('runtime (mins)');
  if (iType < 0 || iTitle < 0) return out;
  const get = (r, i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');
  const idOf = (r) => imdbId(get(r, iConst)) || imdbId(get(r, iUrl));

  const series = (entries || []).filter((e) => e.type === 'series');
  const byTt = new Map();
  series.forEach((e) => { const id = imdbId(e.imdbUrl); if (id) byTt.set(id, e); });
  const byName = new Map();
  const addName = (name, e) => { const k = norm(name); if (k && !byName.has(k)) byName.set(k, e); };
  series.forEach((e) => addName(e.title, e));
  rows.slice(1).forEach((r) => {
    if (kindOf(get(r, iType)) !== 'series') return;
    const e = byTt.get(idOf(r));
    if (e) { addName(get(r, iTitle), e); addName(get(r, iOrig), e); }
  });

  const groups = new Map();
  const unmatched = new Map();
  const seen = new Set();
  for (const r of rows.slice(1)) {
    const t = norm(get(r, iType)).replace(/[^a-z]/g, '');
    if (t !== 'tvepisode' && t !== 'episodiodetv' && t !== 'episodiodetelevisao') continue;
    const tt = idOf(r);
    if (!tt || seen.has(tt)) continue;
    seen.add(tt);
    let hit = null;
    for (const title of [get(r, iTitle), get(r, iOrig)]) {
      // Do prefixo mais longo ao mais curto: "Star Wars: The Clone Wars: X" prefere a série mais específica.
      for (let i = title.lastIndexOf(': '); i > 0 && !hit; i = title.lastIndexOf(': ', i - 1)) hit = byName.get(norm(title.slice(0, i)));
      if (hit) break;
    }
    if (!hit) {
      const name = get(r, iTitle).split(': ')[0];
      unmatched.set(name, (unmatched.get(name) || 0) + 1);
      continue;
    }
    if (!groups.has(hit.id)) groups.set(hit.id, { entryId: hit.id, eps: [] });
    groups.get(hit.id).eps.push({ tt, minutes: parseInt(get(r, iRuntime), 10) || 0 });
    out.matched++;
  }
  out.groups = [...groups.values()];
  out.series = out.groups.length;
  out.unmatched = [...unmatched.entries()].sort((a, b) => b[1] - a[1]).map(([title, count]) => ({ title, count }));
  return out;
}

module.exports = { parseCsv, translateGenres, buildImport, buildEpisodes, imdbId };
