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
  const region = String(opts.region || 'BR').toUpperCase();
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

  function keyParam() { return bearer ? '' : '&api_key=' + encodeURIComponent(key); }
  async function getJson(url) {
    const res = await get(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('TMDB respondeu ' + res.status);
    return res.json();
  }
  const names = (list) => (Array.isArray(list) ? list : []).map((x) => x && x.provider_name).filter(Boolean);

  // Sinopse, elenco, direção e onde assistir (região BR). Devolve null se o TMDB não conhece o título.
  async function detailsFor(entry) {
    const id = imdbId(entry.imdbUrl);
    if (!id || entry.type === 'game') return null;
    const found = await getJson(apiBase + '/find/' + id + '?external_source=imdb_id&language=pt-BR' + keyParam());
    if (!found) return null;
    const movies = (found.movie_results || []).map((x) => ({ kind: 'movie', id: x.id }));
    const shows = (found.tv_results || []).map((x) => ({ kind: 'tv', id: x.id }));
    const hit = (entry.type === 'series' ? shows.concat(movies) : movies.concat(shows)).find((x) => x.id);
    if (!hit) return null;

    const base = apiBase + '/' + hit.kind + '/' + hit.id;
    const d = await getJson(base + '?language=pt-BR&append_to_response=credits,watch/providers' + keyParam());
    if (!d) return null;
    let overview = String(d.overview || '').trim();
    let tagline = String(d.tagline || '').trim();
    if (!overview) { // sem sinopse em português: usa a original em inglês
      const en = await getJson(base + '?language=en-US' + keyParam());
      if (en) { overview = String(en.overview || '').trim(); tagline = tagline || String(en.tagline || '').trim(); }
    }
    const credits = d.credits || {};
    const directors = hit.kind === 'movie'
      ? (credits.crew || []).filter((c) => c && c.job === 'Director').map((c) => c.name)
      : (d.created_by || []).map((c) => c && c.name);
    const cast = (credits.cast || []).slice(0, 12).filter((c) => c && c.name).map((c) => ({ name: c.name, character: c.character || '' }));
    const wp = (d['watch/providers'] && d['watch/providers'].results && d['watch/providers'].results[region]) || null;
    return {
      kind: hit.kind,
      tmdbId: hit.id,
      tmdbUrl: 'https://www.themoviedb.org/' + hit.kind + '/' + hit.id,
      title: d.title || d.name || '',
      originalTitle: d.original_title || d.original_name || '',
      tagline,
      overview,
      releaseDate: d.release_date || d.first_air_date || '',
      runtime: hit.kind === 'movie' ? (d.runtime || 0) : 0,
      seasons: hit.kind === 'tv' ? (d.number_of_seasons || 0) : 0,
      episodes: hit.kind === 'tv' ? (d.number_of_episodes || 0) : 0,
      genres: (d.genres || []).map((g) => g && g.name).filter(Boolean),
      voteAverage: d.vote_average ? Math.round(d.vote_average * 10) / 10 : 0,
      directors: directors.filter(Boolean),
      cast,
      providers: wp ? { region, link: wp.link || '', flatrate: names(wp.flatrate), rent: names(wp.rent), buy: names(wp.buy) } : null
    };
  }

  // Temporada e número de um episódio (pelo código tt do episódio). null se o TMDB não o conhece.
  async function episodeInfo(tt) {
    const found = await getJson(apiBase + '/find/' + tt + '?external_source=imdb_id' + keyParam());
    const ep = found && (found.tv_episode_results || [])[0];
    if (!ep || !Number.isInteger(ep.season_number)) return null;
    return { showId: ep.show_id, season: ep.season_number, number: ep.episode_number };
  }

  // Total de temporadas e episódios da série (sem os "especiais", temporada 0).
  async function showTotals(showId) {
    const d = await getJson(apiBase + '/tv/' + showId + '?language=pt-BR' + keyParam());
    if (!d) return null;
    const real = (d.seasons || []).filter((x) => x && x.season_number > 0);
    const seasons = real.length || d.number_of_seasons || 0;
    const episodes = real.reduce((a, x) => a + (x.episode_count || 0), 0) || d.number_of_episodes || 0;
    return { seasons, episodes };
  }

  return { posterFor, detailsFor, episodeInfo, showTotals };
}

module.exports = { createTmdb, imdbId };
