'use strict';
// Busca de pôsteres no TMDB (https://www.themoviedb.org) a partir do ID do IMDb.
// Precisa de uma chave gratuita (TMDB_API_KEY): aceita a "API Key" (v3) ou o "Read Access Token" (v4).

function imdbId(url) {
  const m = String(url || '').match(/tt\d{6,10}/i);
  return m ? m[0].toLowerCase() : null;
}

function createTmdb(opts) {
  const key = String((opts && opts.key) || '').trim();
  if (!key) return null;
  const apiBase = (opts.apiBase || 'https://api.themoviedb.org/3').replace(/\/$/, '');
  const imageBase = (opts.imageBase || 'https://image.tmdb.org/t/p/w500').replace(/\/$/, '');
  const timeoutMs = opts.timeoutMs || 10000;
  const bearer = key.length > 40; // token v4 é um JWT longo; a chave v3 tem 32 caracteres

  function headers() {
    const h = { accept: 'application/json' };
    if (bearer) h.authorization = 'Bearer ' + key;
    return h;
  }
  async function get(url, retry) {
    const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 401 || res.status === 403) {
      const e = new Error('Chave do TMDB recusada. Confira TMDB_API_KEY.'); e.fatal = true; throw e;
    }
    if (res.status === 429 && !retry) {
      const wait = Math.min(10, parseInt(res.headers.get('retry-after'), 10) || 2);
      await new Promise((r) => setTimeout(r, wait * 1000));
      return get(url, true);
    }
    return res;
  }

  // Devolve um Buffer com o pôster ou null se não houver.
  async function posterFor(entry) {
    const id = imdbId(entry.imdbUrl);
    if (!id || entry.type === 'game') return null;
    const url = apiBase + '/find/' + id + '?external_source=imdb_id&language=pt-BR' + (bearer ? '' : '&api_key=' + encodeURIComponent(key));
    const res = await get(url);
    if (!res.ok) throw new Error('TMDB respondeu ' + res.status);
    const data = await res.json();
    const movies = data.movie_results || [];
    const shows = data.tv_results || [];
    const list = entry.type === 'series' ? shows.concat(movies) : movies.concat(shows);
    const hit = list.find((x) => x && x.poster_path);
    if (!hit) return null;
    const img = await get(imageBase + hit.poster_path);
    if (!img.ok) return null;
    return Buffer.from(await img.arrayBuffer());
  }

  return { posterFor };
}

module.exports = { createTmdb, imdbId };
