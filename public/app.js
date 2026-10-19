(function () {
  var STATUS = {
    series: ['Assistindo', 'Completa']
  };
  var LABELS = {
    movie: { name: 'filme', plural: 'filmes', extraLabel: 'Ano de lançamento' },
    series: { name: 'série', plural: 'séries', extraLabel: 'Temporadas assistidas' }
  };

  var entries = [];
  // O app é só de filmes e séries; registros antigos de jogos ficam guardados no banco, mas não aparecem.
  function visible(list) { return list.filter(function (e) { return e.type === 'movie' || e.type === 'series'; }); }
  var shareBgVersion = null;
  var logoVersion = null;

  var state = {
    activeTab: 'movie',
    search: '',
    sort: 'recent',
    editingId: null,
    formOpen: false,
    genreFilter: null,
    ratingFilter: 'all',
    genreBreakdownCollapsed: false
  };

  // ---- API ----
  function api(method, url, body, raw) {
    var opts = { method: method, credentials: 'same-origin', headers: {} };
    if (raw) {
      opts.body = raw;
      opts.headers['Content-Type'] = raw.type || 'application/octet-stream';
    } else if (body !== undefined) {
      opts.body = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
    }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401) { location.replace('/login'); throw new Error('Sessão expirada.'); }
        if (!r.ok) throw new Error(data.error || 'Erro ao falar com o servidor.');
        return data;
      });
    });
  }

  function findEditing() {
    return state.editingId ? entries.find(function (e) { return e.id === state.editingId; }) : null;
  }

  function formatDuration(min) {
    min = parseInt(min, 10) || 0;
    if (!min) return '';
    var MIN_HOUR = 60;
    var MIN_DAY = MIN_HOUR * 24;
    var MIN_MONTH = MIN_DAY * 30;
    var MIN_YEAR = MIN_DAY * 365;

    if (min < MIN_HOUR) {
      return min + 'min';
    }
    if (min < MIN_DAY) {
      var h = Math.floor(min / 60);
      var m = min % 60;
      return h + 'h' + (m ? (m < 10 ? '0' : '') + m + 'min' : '');
    }
    if (min < MIN_MONTH) {
      var d = Math.floor(min / MIN_DAY);
      var remH = Math.floor((min % MIN_DAY) / MIN_HOUR);
      var out = d + (d === 1 ? ' dia' : ' dias');
      if (remH) out += ' ' + remH + 'h';
      return out;
    }
    if (min < MIN_YEAR) {
      var mo = Math.floor(min / MIN_MONTH);
      var remD = Math.floor((min % MIN_MONTH) / MIN_DAY);
      var out2 = mo + (mo === 1 ? ' mês' : ' meses');
      if (remD) out2 += ' ' + remD + (remD === 1 ? ' dia' : ' dias');
      return out2;
    }
    var y = Math.floor(min / MIN_YEAR);
    var remMo = Math.floor((min % MIN_YEAR) / MIN_MONTH);
    var out3 = y + (y === 1 ? ' ano' : ' anos');
    if (remMo) out3 += ' ' + remMo + (remMo === 1 ? ' mês' : ' meses');
    return out3;
  }

  function showToast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(showToast._h);
    showToast._h = setTimeout(function () { t.classList.add('hidden'); }, 3200);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Nota de 1 a 10, como no IMDb.
  function num(r) { var n = parseFloat(r); return isFinite(n) ? n : 0; }
  function formatRating(r) { return String(num(r)); }
  function formatAvg(n) { return n.toFixed(1).replace('.', ','); }

  function renderTabs() {
    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.type === state.activeTab);
    });
    ['movie', 'series'].forEach(function (t) {
      var c = entries.filter(function (e) { return e.type === t; }).length;
      document.getElementById('count-' + t).textContent = c ? '· ' + c : '';
    });
  }

  function isSameMonth(dateStr) {
    if (!dateStr) return false;
    var d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return false;
    var now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }

  function renderStats() {
    var list = entries.filter(function (e) { return e.type === state.activeTab; });
    var total = list.length;
    var rated = list.filter(function (e) { return e.rating > 0; });
    var avg = rated.length ? formatAvg(rated.reduce(function (s, e) { return s + e.rating; }, 0) / rated.length) : '—';
    var extra = '';
    if (state.activeTab === 'movie') {
      var totalMinutes = list.reduce(function (s, e) { return s + (parseInt(e.duration, 10) || 0); }, 0);
      if (totalMinutes > 0) {
        extra += '<div><b>' + formatDuration(totalMinutes) + '</b>assistidos</div>';
      }
      var moviesThisMonth = list.filter(function (e) { return isSameMonth(e.date); }).length;
      extra += '<div><b>' + moviesThisMonth + '</b>assistidos este mês</div>';
    } else {
      var completas = list.filter(function (e) { return e.status === 'Completa'; }).length;
      extra = '<div><b>' + completas + '</b>completas</div>';
      var totalMinutesS = list.reduce(function (s, e) { return s + (parseInt(e.duration, 10) || 0); }, 0);
      if (totalMinutesS > 0) {
        extra += '<div><b>' + formatDuration(totalMinutesS) + '</b>assistidos</div>';
      }
      var episodesTotal = list.reduce(function (s, e) { return s + (parseInt(e.episodes, 10) || 0); }, 0);
      extra += '<div><b>' + episodesTotal.toLocaleString('pt-BR') + '</b>episódios assistidos</div>';
    }
    document.getElementById('stats').innerHTML =
      '<div><b>' + total + '</b>' + LABELS[state.activeTab].plural + ' registrados</div>' +
      '<div><b>' + avg + '</b>nota média</div>' + extra;
  }

  function metaLine(e) {
    if (e.type === 'movie') {
      var bits2 = [];
      if (e.year) bits2.push(e.year);
      if (e.duration) bits2.push(formatDuration(e.duration));
      return bits2.join(' · ');
    }
    var bits3 = [];
    if (e.extra) bits3.push(escapeHtml(e.extra) + (isNaN(e.extra) ? '' : 'ª temp.'));
    if (e.episodes) bits3.push(e.episodes + ' ep.');
    return bits3.join(' · ');
  }

  function formatDate(iso) {
    if (!iso) return '';
    var parts = iso.split('-');
    if (parts.length !== 3) return iso;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }

  function hashStr(s) {
    var h = 0;
    s = s || '';
    for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }

  function posterPlaceholder(e) {
    var palettes = {
      movie: ['#c1542e', '#7a3119'],
      series: ['#b9842a', '#6f5215']
    };
    var base = palettes[e.type] || palettes.movie;
    var angle = (hashStr(e.title) % 140) + 20;
    return 'background:linear-gradient(' + angle + 'deg,' + base[0] + ',' + base[1] + ')';
  }

  // Filtro de nota: 'all' | 'none' | 'n:8' (exata) | 'r:7-8' (faixa)
  function matchesRating(e, f) {
    var r = Math.round(num(e.rating));
    if (f === 'all') return true;
    if (f === 'none') return r === 0;
    var m = f.match(/^n:(\d+)$/);
    if (m) return r === parseInt(m[1], 10);
    m = f.match(/^r:(\d+)-(\d+)$/);
    return !!m && r >= parseInt(m[1], 10) && r <= parseInt(m[2], 10);
  }

  function ratingFilterLabel(f) {
    var sel = document.getElementById('rating-filter');
    var opt = sel && sel.querySelector('option[value="' + f + '"]');
    return opt ? opt.textContent : '';
  }

  function renderFilterSummary(shown, total) {
    var el = document.getElementById('filter-summary');
    var parts = [];
    if (state.ratingFilter !== 'all') parts.push(ratingFilterLabel(state.ratingFilter).toLowerCase());
    if (state.activeTab === 'movie' && state.genreFilter) parts.push(escapeHtml(state.genreFilter));
    if (state.search.trim()) parts.push('“' + escapeHtml(state.search.trim()) + '”');
    if (!parts.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.classList.remove('hidden');
    el.innerHTML = '<b>' + shown + '</b> de ' + total + ' ' + LABELS[state.activeTab].plural + ' · ' + parts.join(' · ') +
      ' <button type="button" class="filter-clear" id="filter-clear-btn">Limpar filtros</button>';
  }

  function renderList() {
    var list = entries.filter(function (e) { return e.type === state.activeTab; });
    var tabTotal = list.length;
    if (state.ratingFilter !== 'all') {
      list = list.filter(function (e) { return matchesRating(e, state.ratingFilter); });
    }
    if (state.activeTab === 'movie' && state.genreFilter) {
      list = list.filter(function (e) { return (e.genres || []).indexOf(state.genreFilter) !== -1; });
    }
    if (state.search.trim()) {
      var q = state.search.trim().toLowerCase();
      list = list.filter(function (e) { return e.title.toLowerCase().indexOf(q) !== -1; });
    }
    if (state.sort === 'title') {
      list.sort(function (a, b) { return a.title.localeCompare(b.title, 'pt-BR'); });
    } else if (state.sort === 'rating') {
      list.sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
    } else {
      list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    }

    renderFilterSummary(list.length, tabTotal);
    var listEl = document.getElementById('list');
    var emptyEl = document.getElementById('empty-state');
    if (!list.length) {
      listEl.innerHTML = '';
      emptyEl.classList.remove('hidden');
      var total = entries.filter(function (e) { return e.type === state.activeTab; }).length;
      emptyEl.textContent = total === 0
        ? 'Nada por aqui ainda. Toque em "+ Adicionar" para registrar seu primeiro ' + LABELS[state.activeTab].name + '.'
        : 'Nenhum ' + LABELS[state.activeTab].name + ' com esse filtro.';
      return;
    }
    emptyEl.classList.add('hidden');

    listEl.innerHTML = list.map(function (e) {
      var hasCover = !!e.coverUrl;
      var posterInner = hasCover
        ? '<div class="poster-img" style="background-image:url(&quot;' + escapeHtml(e.coverUrl) + '&quot;)"></div>'
        : '<div class="poster-img poster-placeholder" style="' + posterPlaceholder(e) + '"><span class="poster-initial">' + escapeHtml((e.title || '?').trim().charAt(0).toUpperCase()) + '</span></div>';
      var ratingBadge = e.rating ? '<span class="poster-rating">★ ' + formatRating(e.rating) + '</span>' : '';
      var statusBadge = e.status ? '<span class="poster-status">' + escapeHtml(e.status) + '</span>' : '';
      var genreHtml = '';
      if (e.genres && e.genres.length) {
        var shown = e.genres.slice(0, 2).map(function (g) { return '<span class="genre-tag">' + escapeHtml(g) + '</span>'; }).join('');
        var more = e.genres.length > 2 ? '<span class="genre-tag">+' + (e.genres.length - 2) + '</span>' : '';
        genreHtml = '<div class="genre-tags">' + shown + more + '</div>';
      }
      return '' +
        '<article class="card type-' + e.type + '" data-id="' + e.id + '">' +
          '<div class="poster" tabindex="0" title="Ver detalhes">' +
            posterInner +
            '<div class="poster-top">' + statusBadge + ratingBadge + '</div>' +
            '<div class="poster-actions">' +
              '<button class="icon-btn" data-action="edit" title="Editar">✎</button>' +
              '<button class="icon-btn danger" data-action="delete" title="Excluir">✕</button>' +
            '</div>' +
            '<div class="poster-overlay">' +
              '<h3 class="card-title">' + escapeHtml(e.title) + '</h3>' +
              '<div class="card-meta">' + metaLine(e) + '</div>' +
            '</div>' +
          '</div>' +
          genreHtml +
          (e.imdbUrl ? '<div class="card-imdb"><a href="' + escapeHtml(e.imdbUrl) + '" target="_blank" rel="noopener">IMDb ↗</a></div>' : '') +
        '</article>';
    }).join('');
  }

  function renderGenreBreakdown() {
    var panel = document.getElementById('genre-breakdown');
    if (state.activeTab !== 'movie') {
      panel.classList.add('hidden');
      panel.innerHTML = '';
      return;
    }
    var counts = {};
    entries.filter(function (e) { return e.type === 'movie'; }).forEach(function (e) {
      (e.genres || []).forEach(function (g) {
        g = g.trim();
        if (!g) return;
        counts[g] = (counts[g] || 0) + 1;
      });
    });
    var list = Object.keys(counts).map(function (g) { return { genre: g, count: counts[g] }; });
    list.sort(function (a, b) { return b.count - a.count || a.genre.localeCompare(b.genre, 'pt-BR'); });
    if (!list.length) {
      panel.classList.add('hidden');
      panel.innerHTML = '';
      return;
    }
    var max = list[0].count;
    panel.classList.remove('hidden');
    var collapsed = !!state.genreBreakdownCollapsed;
    panel.innerHTML =
      '<div class="genre-breakdown-head" id="genre-breakdown-toggle" role="button" tabindex="0">' +
        '<h3>Filmes por gênero <span class="genre-toggle-icon">' + (collapsed ? '▸' : '▾') + '</span></h3>' +
        (state.genreFilter ? '<button type="button" class="genre-clear" id="genre-clear-btn">Limpar filtro ✕</button>' : '') +
      '</div>' +
      (collapsed ? '' : list.map(function (item) {
        var pct = Math.max(6, Math.round((item.count / max) * 100));
        var active = state.genreFilter === item.genre;
        return '<div class="genre-row' + (active ? ' active' : '') + '" data-genre="' + escapeHtml(item.genre) + '" role="button" tabindex="0">' +
          '<span class="genre-label">' + escapeHtml(item.genre) + '</span>' +
          '<div class="genre-bar-track"><div class="genre-bar-fill" style="width:' + pct + '%"></div></div>' +
          '<span class="genre-count">' + item.count + '</span>' +
        '</div>';
      }).join(''));
  }

  var MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  function getRecapData() {
    var movies = entries.filter(function (e) { return e.type === 'movie'; });
    var series = entries.filter(function (e) { return e.type === 'series'; });
    var sum = function (list, k) { return list.reduce(function (s, e) { return s + (parseInt(e[k], 10) || 0); }, 0); };
    var now = new Date();
    var byDate = function (a, b) { return (a.date || '').localeCompare(b.date || ''); };
    var monthMovies = movies.filter(function (e) { return isSameMonth(e.date); }).sort(byDate);
    var monthSeries = series.filter(function (e) { return isSameMonth(e.date); }).sort(byDate);
    var best = function (list) {
      var top = null;
      list.forEach(function (e) { if (num(e.rating) > 0 && (!top || num(e.rating) > num(top.rating))) top = e; });
      return top;
    };
    return {
      monthLabel: MONTH_NAMES[now.getMonth()] + ' de ' + now.getFullYear(),
      year: now.getFullYear(),
      monthName: MONTH_NAMES[now.getMonth()],
      totalMovies: movies.length,
      totalSeries: series.length,
      movieMinutes: sum(movies, 'duration'),
      seriesMinutes: sum(series, 'duration'),
      totalEpisodes: sum(series, 'episodes'),
      monthMovies: monthMovies,
      monthSeries: monthSeries,
      monthItems: monthMovies.concat(monthSeries).sort(byDate),
      monthMinutes: sum(monthMovies, 'duration'),
      topMovie: best(monthMovies),
      topSeries: best(monthSeries)
    };
  }

  function canShareFiles() {
    try {
      if (!(window.matchMedia && matchMedia('(pointer: coarse)').matches)) return false;
      return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'a.png', { type: 'image/png' })] }));
    } catch (err) { return false; }
  }

  // A tela Compartilhar: mostra a própria imagem que será baixada (assim o que se vê é o que se posta).
  var sharePreviewToken = 0;
  var sharePreviewUrl = null;

  function renderShare() {
    var el = document.getElementById('share-view');
    var on = state.activeTab === 'share';
    document.body.classList.toggle('view-share', on);
    el.classList.toggle('hidden', !on);
    if (!on) return;
    var FMT = SHARE_FORMATS[shareFormat] || SHARE_FORMATS.square;
    el.innerHTML =
      '<div class="share-head"><h2>Compartilhar</h2>' +
        '<p>Resumo de ' + escapeHtml(getRecapData().monthLabel) + ' com o total de filmes e séries e o que foi assistido no mês.</p></div>' +
      '<div class="share-stage"><img id="share-preview-img" class="share-preview" width="800" height="' + FMT.H + '" alt="Prévia da imagem para compartilhar" style="aspect-ratio:800/' + FMT.H + '"></div>' +
      '<div class="recap-actions">' +
        '<div class="seg" role="group" aria-label="Formato da imagem">' +
          Object.keys(SHARE_FORMATS).map(function (k) {
            return '<button type="button" class="seg-btn' + (k === shareFormat ? ' on' : '') + '" data-fmt="' + k + '" aria-pressed="' + (k === shareFormat) + '">' + SHARE_FORMATS[k].label + '</button>';
          }).join('') +
        '</div>' +
        '<button type="button" class="btn-add" id="recap-image-btn">Baixar imagem</button>' +
        (canShareFiles() ? '<button type="button" class="btn-secondary" id="recap-share-btn">Compartilhar</button>' : '') +
        '<button type="button" class="btn-secondary" id="recap-copy-btn">Copiar texto</button>' +
        '<button type="button" class="btn-secondary" id="recap-bg-btn">' + (shareBgVersion ? 'Trocar fundo' : 'Escolher fundo') + '</button>' +
        (shareBgVersion ? '<button type="button" class="btn-secondary" id="recap-bg-remove">Remover fundo</button>' : '') +
      '</div>';
    refreshSharePreview();
  }

  function refreshSharePreview() {
    var img = document.getElementById('share-preview-img');
    if (!img || state.activeTab !== 'share') return;
    var token = ++sharePreviewToken;
    img.classList.add('loading');
    buildShareImage().then(function (blob) {
      if (token !== sharePreviewToken || !blob) return;
      var url = URL.createObjectURL(blob);
      img.onload = function () { img.classList.remove('loading'); };
      img.src = url;
      if (sharePreviewUrl) URL.revokeObjectURL(sharePreviewUrl);
      sharePreviewUrl = url;
    }).catch(function () { img.classList.remove('loading'); });
  }

  function buildRecapText() {
    var d = getRecapData();
    var lines = [];
    var cap = d.monthName.charAt(0).toUpperCase() + d.monthName.slice(1);
    lines.push('🎬 WAndCine — ' + d.monthLabel);
    lines.push('');
    lines.push('Total: ' + d.totalMovies + ' filmes · ' + d.totalSeries + ' séries' + (d.totalEpisodes ? ' · ' + d.totalEpisodes.toLocaleString('pt-BR') + ' episódios' : ''));
    var tparts = [];
    if (d.movieMinutes) tparts.push(formatDuration(d.movieMinutes) + ' de filmes');
    if (d.seriesMinutes) tparts.push(formatDuration(d.seriesMinutes) + ' de séries');
    if (tparts.length) lines.push('Tempo assistido: ' + tparts.join(' + '));
    lines.push('');
    lines.push(cap + ': ' + d.monthMovies.length + (d.monthMovies.length === 1 ? ' filme' : ' filmes') + (d.monthMinutes ? ' (' + formatDuration(d.monthMinutes) + ')' : '') +
      ' · ' + d.monthSeries.length + (d.monthSeries.length === 1 ? ' série' : ' séries'));
    if (d.topMovie) lines.push('⭐ Filme do mês: ' + d.topMovie.title + ' (' + formatRating(d.topMovie.rating) + '/10)');
    if (d.topSeries) lines.push('⭐ Série do mês: ' + d.topSeries.title + ' (' + formatRating(d.topSeries.rating) + '/10)');
    if (!d.monthItems.length) {
      lines.push('', 'Nada registrado este mês ainda.');
    } else {
      if (d.monthMovies.length) { lines.push('', 'Filmes:'); d.monthMovies.forEach(function (e) { lines.push('• ' + e.title); }); }
      if (d.monthSeries.length) { lines.push('', 'Séries:'); d.monthSeries.forEach(function (e) { var pr = seriesProgress(e); lines.push('• ' + e.title + (pr ? ' — ' + pr : '')); }); }
    }
    return lines.join('\n');
  }

  async function copyRecapText() {
    var text = buildRecapText();
    try {
      await navigator.clipboard.writeText(text);
      showToast('Texto copiado!');
    } catch (err) {
      showToast('Não foi possível copiar automaticamente.');
    }
  }

  // ---- Imagem quadrada (800x800) para redes sociais, desenhada direto no canvas ----
  var SHARE_FORMATS = {
    square: {
      H: 800, label: '800×800', M: 30, headerH: 84, logoR: 30, titleSize: 56, subSize: 12, tagSize: 22,
      statsH: 84, statsStack: false, gap: 10, secH: 24, secFont: 22, heroH: 118, heroPill: false,
      legendCard: false, bottom: 16, maxTile: 120
    },
    portrait: {
      H: 1000, label: '800×1000', M: 36, headerH: 108, logoR: 38, titleSize: 68, subSize: 13, tagSize: 26,
      statsH: 126, statsStack: true, gap: 14, secH: 30, secFont: 26, heroH: 160, heroPill: true,
      legendCard: true, bottom: 24, maxTile: 124
    }
  };
  var shareFormat = 'square';
  try { var savedFmt = localStorage.getItem('wandcine.shareFormat'); if (SHARE_FORMATS[savedFmt]) shareFormat = savedFmt; } catch (_) { /* sem armazenamento */ }
  var SHARE = { W: 800, AMBER: '#f0b13a', DISPLAY: '"Bebas Neue", "Arial Narrow", Impact, sans-serif', BODY: '"Work Sans", -apple-system, "Segoe UI", sans-serif', SCRIPT: '"Caveat", "Segoe Script", "Brush Script MT", cursive' };

  function loadImage(src) {
    return new Promise(function (resolve) {
      if (!src) { resolve(null); return; }
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapLines(ctx, text, maxW) {
    var words = String(text).split(/\s+/).filter(Boolean);
    var lines = [];
    var cur = '';
    words.forEach(function (w) {
      var test = cur ? cur + ' ' + w : w;
      if (cur && ctx.measureText(test).width > maxW) { lines.push(cur); cur = w; } else { cur = test; }
    });
    if (cur) lines.push(cur);
    return lines;
  }

  function ellipsize(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    return text + '…';
  }

  function fitText(ctx, text, family, weight, sizes, maxW, maxLines) {
    var lines = [];
    var size = sizes[sizes.length - 1];
    for (var i = 0; i < sizes.length; i++) {
      size = sizes[i];
      ctx.font = weight + ' ' + size + 'px ' + family;
      lines = wrapLines(ctx, text, maxW);
      if (lines.length <= maxLines) return { size: size, lines: lines };
    }
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = ellipsize(ctx, lines[maxLines - 1] + ' …', maxW);
    return { size: size, lines: lines };
  }

  function drawStar(ctx, cx, cy, r, fill) {
    ctx.beginPath();
    for (var k = 0; k < 10; k++) {
      var rad = (k % 2 === 0) ? r : r * 0.45;
      var a = -Math.PI / 2 + k * Math.PI / 5;
      ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawPoster(ctx, e, img, x, y, w, h, radius) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    roundRectPath(ctx, x, y, w, h, radius);
    ctx.fillStyle = '#2d251d';
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRectPath(ctx, x, y, w, h, radius);
    ctx.clip();
    if (img) {
      var sc = Math.max(w / img.width, h / img.height);
      var sw = w / sc, sh = h / sc;
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
    } else {
      var pal = { movie: ['#c1542e', '#7a3119'], series: ['#b9842a', '#6f5215'] }[e.type] || ['#c1542e', '#7a3119'];
      var th = ((hashStr(e.title) % 140) + 20) * Math.PI / 180;
      var vx = Math.sin(th), vy = -Math.cos(th);
      var len = Math.abs(w * vx) + Math.abs(h * vy);
      var cx = x + w / 2, cy = y + h / 2;
      var g = ctx.createLinearGradient(cx - vx * len / 2, cy - vy * len / 2, cx + vx * len / 2, cy + vy * len / 2);
      g.addColorStop(0, pal[0]);
      g.addColorStop(1, pal[1]);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.font = Math.round(h * 0.3) + 'px ' + SHARE.DISPLAY;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((e.title || '?').trim().charAt(0).toUpperCase(), x + w / 2, y + h / 2);
    }
    ctx.restore();
  }

  // ---- Selos por nota (imagem de compartilhamento) ----
  var BADGES = {
    skip: { key: 'skip', range: 'Até 4', label: 'Quero meu tempo de volta', color: '#e5534b', icon: 'heartbreak' },
    rec: { key: 'rec', range: '5 a 8', label: 'Fica a indicação', color: '#f2b632', icon: 'star' },
    must: { key: 'must', range: '9 ou 10', label: 'Já deveria ter assistido', color: '#3ecf7c', icon: 'trophy' }
  };
  // Até 4: não valeu o tempo · 5 a 8: vale a indicação · 9 e 10: obrigatório. Sem nota: sem selo.
  function badgeFor(e) {
    var r = Math.round(num(e.rating));
    if (r <= 0) return null;
    if (r <= 4) return BADGES.skip;
    if (r <= 8) return BADGES.rec;
    return BADGES.must;
  }

  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  // Ícones simples desenhados em código, numa grade 24x24 (`cut` = cor do fundo, para recortes).
  function drawIcon(ctx, kind, cx, cy, size, color, cut) {
    var k = size / 24, i, a;
    ctx.save();
    ctx.translate(cx - 12 * k, cy - 12 * k);
    ctx.scale(k, k);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (kind === 'star') {
      ctx.beginPath();
      for (i = 0; i < 10; i++) { a = -Math.PI / 2 + i * Math.PI / 5; ctx.lineTo(12 + Math.cos(a) * (i % 2 ? 4.9 : 11), 12.8 + Math.sin(a) * (i % 2 ? 4.9 : 11)); }
      ctx.closePath(); ctx.fill();
    } else if (kind === 'trophy') {
      ctx.beginPath();
      ctx.moveTo(6.5, 3); ctx.lineTo(17.5, 3); ctx.lineTo(17.5, 8.5);
      ctx.bezierCurveTo(17.5, 12, 15, 14.5, 12, 14.5); ctx.bezierCurveTo(9, 14.5, 6.5, 12, 6.5, 8.5);
      ctx.closePath(); ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(6.5, 5); ctx.bezierCurveTo(2, 5, 2, 11, 7, 11.4);
      ctx.moveTo(17.5, 5); ctx.bezierCurveTo(22, 5, 22, 11, 17, 11.4);
      ctx.stroke();
      ctx.fillRect(10.8, 14.2, 2.4, 4.2);
      ctx.fillRect(7.5, 18.4, 9, 2.6);
    } else if (kind === 'heartbreak') {
      ctx.beginPath();
      ctx.moveTo(12, 21);
      ctx.bezierCurveTo(4.5, 15, 2, 11.8, 2, 8.3); ctx.bezierCurveTo(2, 5.5, 4.2, 3.5, 6.8, 3.5);
      ctx.bezierCurveTo(9, 3.5, 10.8, 4.8, 12, 6.5); ctx.bezierCurveTo(13.2, 4.8, 15, 3.5, 17.2, 3.5);
      ctx.bezierCurveTo(19.8, 3.5, 22, 5.5, 22, 8.3); ctx.bezierCurveTo(22, 11.8, 19.5, 15, 12, 21);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = cut || '#000';
      ctx.lineWidth = 1.9;
      ctx.beginPath(); ctx.moveTo(12, 6.4); ctx.lineTo(9.8, 10.2); ctx.lineTo(13.4, 12.4); ctx.lineTo(10.6, 16.4); ctx.stroke();
    } else if (kind === 'clapper') {
      ctx.fillRect(3, 10.5, 18, 10.5);
      ctx.fillRect(3, 5.2, 18, 4);
      ctx.strokeStyle = cut || '#000';
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      [8, 13, 18].forEach(function (x) { ctx.moveTo(x, 5.2); ctx.lineTo(x - 2.6, 9.2); });
      ctx.stroke();
    } else if (kind === 'tv') {
      ctx.strokeRect(3, 7.5, 18, 12.5);
      ctx.beginPath(); ctx.moveTo(8.5, 3.2); ctx.lineTo(12, 7.5); ctx.lineTo(15.5, 3.2); ctx.stroke();
    } else if (kind === 'clock') {
      ctx.beginPath(); ctx.arc(12, 12, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(12, 6.5); ctx.lineTo(12, 12); ctx.lineTo(15.8, 14.2); ctx.stroke();
    } else if (kind === 'play') {
      ctx.strokeRect(3, 5.5, 18, 13);
      ctx.beginPath(); ctx.moveTo(10, 9); ctx.lineTo(10, 15); ctx.lineTo(15.2, 12); ctx.closePath(); ctx.fill();
    } else if (kind === 'crown') {
      ctx.beginPath();
      ctx.moveTo(3, 18); ctx.lineTo(2, 7); ctx.lineTo(8, 12); ctx.lineTo(12, 5); ctx.lineTo(16, 12); ctx.lineTo(22, 7); ctx.lineTo(21, 18);
      ctx.closePath(); ctx.fill();
      ctx.fillRect(3, 19.4, 18, 2.2);
    } else if (kind === 'reel') {
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(12, 12, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(12, 12, 1.7, 0, Math.PI * 2); ctx.fill();
      for (i = 0; i < 5; i++) {
        a = -Math.PI / 2 + i * 2 * Math.PI / 5;
        ctx.beginPath(); ctx.arc(12 + Math.cos(a) * 5.6, 12 + Math.sin(a) * 5.6, 2.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  // Selo redondo (disco colorido com anel claro e o ícone da nota).
  function drawBadge(ctx, b, cx, cy, r) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = r * 0.5;
    ctx.shadowOffsetY = r * 0.18;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = b.color;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, r - r * 0.07, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.stroke();
    drawIcon(ctx, b.icon, cx, cy + (b.key === 'rec' ? r * 0.04 : 0), r * 1.1, b.key === 'skip' ? '#ffffff' : '#1d140a', b.color);
  }

  // Texto com espaçamento entre as letras (letterSpacing não existe em todos os navegadores).
  function spacedWidth(ctx, text, sp) {
    var w = 0;
    for (var i = 0; i < text.length; i++) w += ctx.measureText(text[i]).width + sp;
    return w - sp;
  }
  function spacedText(ctx, text, x, y, sp) {
    for (var i = 0; i < text.length; i++) { ctx.fillText(text[i], x, y); x += ctx.measureText(text[i]).width + sp; }
  }

  // "2 de 5 temp. · 42 ep." a partir dos campos da série.
  function seriesProgress(e) {
    var bits = [];
    var x = String(e.extra || '').trim();
    if (x) bits.push(/^\d+( de \d+)?$/.test(x) ? x + ' temp.' : x);
    if (parseInt(e.episodes, 10) > 0) bits.push(e.episodes + ' ep.');
    return bits.join(' · ');
  }

  function drawCardBox(ctx, x, y, w, h, r, fill, stroke, lw) {
    roundRectPath(ctx, x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = lw || 1; ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  function drawLogoDisc(ctx, img, cx, cy, r, ring) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = '#18110c'; ctx.fill(); ctx.clip();
    var dd = 2 * r;
    ctx.drawImage(img, cx - r - dd * 0.106, cy - r - dd * 0.093, dd * 1.22, dd * 1.22);
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = 2; ctx.strokeStyle = ring; ctx.stroke();
  }

  function drawReel(ctx, cx, cy, R, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#f0b13a'; ctx.fillStyle = '#f0b13a';
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.22, 0, Math.PI * 2); ctx.stroke();
    for (var i = 0; i < 6; i++) {
      var a = i * Math.PI / 3 + 0.3;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R * 0.6, cy + Math.sin(a) * R * 0.6, R * 0.17, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawSection(ctx, icon, text, x, y, w, secH, size) {
    drawIcon(ctx, icon, x + 12, y + secH / 2, secH * 0.82, SHARE.AMBER);
    ctx.fillStyle = SHARE.AMBER;
    ctx.font = size + 'px ' + SHARE.DISPLAY;
    ctx.fillText(text, x + 32, y + secH * 0.8);
    var tw = ctx.measureText(text).width;
    ctx.fillStyle = hexA(SHARE.AMBER, 0.35);
    ctx.fillRect(x + 32 + tw + 14, y + secH / 2, w - (32 + tw + 14), 1);
  }

  // Destaque do mês (filme ou série): pôster, título, nota, progresso e selo.
  function drawHeroCard(ctx, entry, img, label, icon, x0, y0, boxW, hh, o) {
    var hw = Math.round(hh / 1.5), boxH = hh + 28;
    var isSeries = entry.type === 'series';
    var badge = badgeFor(entry);
    var info = isSeries ? seriesProgress(entry) : '';
    var genres = (!isSeries && entry.genres && entry.genres.length) ? entry.genres.join(', ') : '';
    drawCardBox(ctx, x0, y0, boxW, boxH, 16, hexA('#000000', 0.38), hexA(SHARE.AMBER, 0.6), 1.5);
    drawPoster(ctx, entry, img, x0 + 14, y0 + 14, hw, hh, 8);

    var tx = x0 + 14 + hw + 16, tw = x0 + boxW - 16 - tx;
    drawIcon(ctx, icon, tx + 8, y0 + 14 + 9, 16, SHARE.AMBER, '#1b140d');
    ctx.fillStyle = SHARE.AMBER;
    ctx.font = '600 14px ' + SHARE.BODY;
    ctx.fillText(label, tx + 24, y0 + 14 + 14);

    var rated = num(entry.rating) > 0;
    var reserve = (rated ? 34 : 0) + (info ? 22 : 0) + (o.pill && badge ? 32 : 0) + (genres && o.genres ? 20 : 0) + 12;
    var availText = boxH - 14 - 26 - reserve;
    var title = String(entry.title || '').toUpperCase();
    var maxLines = boxW > 500 ? 2 : 3, t = null;
    for (var si = 0; si < o.sizes.length && !t; si++) {
      ctx.font = o.sizes[si] + 'px ' + SHARE.DISPLAY;
      var tl = wrapLines(ctx, title, tw);
      var widest = tl.reduce(function (m, ln) { return Math.max(m, ctx.measureText(ln).width); }, 0);
      if (tl.length <= maxLines && widest <= tw && tl.length * o.sizes[si] * 0.98 <= availText) t = { size: o.sizes[si], lines: tl };
    }
    if (!t) t = fitText(ctx, title, SHARE.DISPLAY, '', [o.sizes[o.sizes.length - 1]], tw, maxLines);
    ctx.fillStyle = '#ffffff';
    ctx.font = t.size + 'px ' + SHARE.DISPLAY;
    var yy = y0 + 14 + 26;
    t.lines.forEach(function (ln, i) { ctx.fillText(ln, tx, yy + t.size * 0.86 + i * t.size * 0.98); });
    yy += t.lines.length * t.size * 0.98 + 6;

    if (genres && o.genres) {
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.font = '400 14px ' + SHARE.BODY;
      ctx.fillText(ellipsize(ctx, genres, tw), tx, yy + 12);
      yy += 20;
    }
    if (rated) {
      drawStar(ctx, tx + 11, yy + 14, 11, SHARE.AMBER);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 ' + (o.big ? 26 : 22) + 'px ' + SHARE.BODY;
      var sc = formatRating(entry.rating);
      ctx.fillText(sc, tx + 30, yy + 22);
      var scW = ctx.measureText(sc).width;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '400 16px ' + SHARE.BODY;
      ctx.fillText('/10', tx + 30 + scW + 3, yy + 22);
      if (badge && !o.pill) drawBadge(ctx, badge, tx + 30 + scW + 3 + ctx.measureText('/10').width + 22, yy + 14, 12);
      yy += 34;
    }
    if (info) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '600 14px ' + SHARE.BODY;
      ctx.fillText(ellipsize(ctx, info, tw), tx, yy + 10);
      yy += 22;
    }
    if (o.pill && badge) {
      var txt = badge.label.toUpperCase();
      ctx.font = '700 11.5px ' + SHARE.BODY;
      var pw = Math.min(tw, 30 + spacedWidth(ctx, txt, 0.4) + 12);
      drawCardBox(ctx, tx, yy + 2, pw, 26, 13, hexA(badge.color, 0.14), badge.color, 1.5);
      drawIcon(ctx, badge.icon, tx + 16, yy + 15, 16, badge.color, '#1b140d');
      ctx.fillStyle = badge.color;
      ctx.save();
      ctx.beginPath(); ctx.rect(tx + 28, yy, pw - 32, 30); ctx.clip();
      spacedText(ctx, txt, tx + 28, yy + 19, 0.4);
      ctx.restore();
    }
  }

  async function buildShareImage() {
    var d = getRecapData();
    var FMT = SHARE_FORMATS[shareFormat] || SHARE_FORMATS.square;
    var W = SHARE.W, H = FMT.H, M = FMT.M, CW = W - 2 * M;
    var AMBER = SHARE.AMBER;
    try {
      await Promise.all([
        document.fonts.load('64px "Bebas Neue"'),
        document.fonts.load('400 16px "Work Sans"'),
        document.fonts.load('600 18px "Work Sans"'),
        document.fonts.load('700 18px "Work Sans"'),
        document.fonts.load('600 24px "Caveat"')
      ]);
    } catch (err) { /* usa as fontes de reserva */ }

    var n = d.monthItems.length;
    var heroes = [];
    if (d.topMovie) heroes.push({ e: d.topMovie, label: 'Filme do mês', icon: 'clapper' });
    if (d.topSeries) heroes.push({ e: d.topSeries, label: 'Série do mês', icon: 'tv' });
    var twoUp = heroes.length === 2;

    // ---- Plano vertical: o que sobra entre os blocos fixos é a grade de pôsteres ----
    var statsTop = M + FMT.headerH + FMT.gap;
    var statsBottom = statsTop + FMT.statsH;
    var heroBox = FMT.heroH + 28;
    var heroTop = statsBottom + FMT.gap + FMT.secH;
    var heroBottom = heroes.length ? heroTop + heroBox : statsBottom;
    var monthSecTop = heroBottom + FMT.gap;
    var gridTop = monthSecTop + FMT.secH;
    var footerBase = H - FMT.bottom;
    var legendH = FMT.legendCard ? 92 : 28;
    var legendTop = footerBase - 26 - 6 - legendH;
    var gridH = legendTop - 10 - gridTop;

    var GAP = 8, PAD = 3, TEXT = 40;
    var cardH = function (w, withText) { return 2 * PAD + Math.round((w - 2 * PAD) * 1.5) + (withText ? TEXT : 0); };
    var tw = 44, withText = false, perRow = 1, fitted = false;
    for (var t0 = FMT.maxTile; t0 >= 44 && !fitted; t0--) {
      var wt = t0 >= 92;
      var c0 = Math.floor((CW + GAP) / (t0 + GAP));
      var r0 = Math.min(4, Math.floor((gridH + GAP) / (cardH(t0, wt) + GAP)));
      if (r0 >= 1 && c0 * r0 >= n) { tw = t0; withText = wt; perRow = c0; fitted = true; }
    }
    var shown = d.monthItems, overflow = 0;
    if (!fitted) {
      tw = 44; withText = false;
      perRow = Math.floor((CW + GAP) / (tw + GAP));
      var rowsMax = Math.max(1, Math.min(4, Math.floor((gridH + GAP) / (cardH(tw, false) + GAP))));
      shown = d.monthItems.slice(0, perRow * rowsMax - 1);
      overflow = n - shown.length;
    }
    var ch = cardH(tw, withText);

    var imgs = await Promise.all([
      loadImage(shareBgVersion ? '/share-bg?v=' + shareBgVersion : null),
      loadImage(logoVersion ? '/logo?v=' + logoVersion : null)
    ].concat(heroes.map(function (h) { return loadImage(h.e.coverUrl); }))
      .concat(shown.map(function (e) { return loadImage(e.coverUrl); })));
    var bgImg = imgs[0], logoImg = imgs[1];
    var heroImgs = imgs.slice(2, 2 + heroes.length);
    var tileImgs = imgs.slice(2 + heroes.length);

    var S = 2;
    var big = document.createElement('canvas');
    big.width = W * S;
    big.height = H * S;
    var ctx = big.getContext('2d');
    ctx.scale(S, S);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    // ---- Fundo ----
    var bg = ctx.createLinearGradient(0, 0, W * 0.6, H);
    bg.addColorStop(0, '#15110d');
    bg.addColorStop(0.55, '#1f1812');
    bg.addColorStop(1, '#2e1a10');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    if (bgImg) {
      ctx.save();
      ctx.globalAlpha = 0.42;
      var bs = Math.max(W / bgImg.width, H / bgImg.height);
      var bw = bgImg.width * bs, bh = bgImg.height * bs;
      ctx.drawImage(bgImg, (W - bw) / 2, (H - bh) / 2, bw, bh);
      ctx.restore();
      var veil = ctx.createLinearGradient(0, 0, 0, H);
      veil.addColorStop(0, 'rgba(14,11,8,0.62)');
      veil.addColorStop(0.5, 'rgba(14,11,8,0.42)');
      veil.addColorStop(1, 'rgba(14,11,8,0.74)');
      ctx.fillStyle = veil;
      ctx.fillRect(0, 0, W, H);
    } else {
      drawReel(ctx, 20, 70, 130, 0.07);
      drawReel(ctx, W - 10, H - 150, 170, 0.06);
    }

    // ---- Cabeçalho: logo, mês e ano, subtítulo, frase ----
    var logoR = FMT.logoR, lcx = M + logoR, lcy = M + logoR + 2;
    if (logoImg) drawLogoDisc(ctx, logoImg, lcx, lcy, logoR, hexA(AMBER, 0.7));
    else drawIcon(ctx, 'clapper', lcx, lcy, logoR * 1.9, AMBER, '#15110d');
    var titleX = M + logoR * 2 + 18;
    var part1 = d.monthName.toUpperCase() + ' DE ', part2 = String(d.year);
    var tSize = FMT.titleSize;
    var tagLines = ['Mais filmes,', 'mais histórias.'];
    ctx.font = '600 ' + FMT.tagSize + 'px ' + SHARE.SCRIPT;
    var tagW = Math.max(ctx.measureText(tagLines[0]).width, ctx.measureText(tagLines[1]).width);
    var titleW;
    for (;;) {
      ctx.font = tSize + 'px ' + SHARE.DISPLAY;
      titleW = ctx.measureText(part1 + part2).width;
      if (titleX + titleW <= W - M || tSize <= 34) break;
      tSize -= 2;
    }
    var tBase = M + tSize * 0.8;
    ctx.fillStyle = '#ffffff';
    ctx.font = tSize + 'px ' + SHARE.DISPLAY;
    ctx.fillText(part1, titleX, tBase);
    ctx.fillStyle = AMBER;
    ctx.fillText(part2, titleX + ctx.measureText(part1).width, tBase);
    var sub = 'FILMES E SÉRIES ASSISTIDOS';
    ctx.font = '500 ' + FMT.subSize + 'px ' + SHARE.BODY;
    var subW = spacedWidth(ctx, sub, 5);
    var subY = tBase + FMT.subSize + 14;
    var mid = titleX + titleW / 2;
    ctx.fillStyle = hexA(AMBER, 0.55);
    ctx.fillRect(titleX, subY - FMT.subSize * 0.35, Math.max(0, mid - subW / 2 - 14 - titleX), 1);
    ctx.fillRect(mid + subW / 2 + 14, subY - FMT.subSize * 0.35, Math.max(0, titleX + titleW - (mid + subW / 2 + 14)), 1);
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    spacedText(ctx, sub, mid - subW / 2, subY, 5);
    if (titleX + titleW + 24 + tagW <= W - M) {
      ctx.save();
      ctx.translate(W - M - tagW, M + 30);
      ctx.rotate(-0.1);
      ctx.fillStyle = AMBER;
      ctx.font = '600 ' + FMT.tagSize + 'px ' + SHARE.SCRIPT;
      ctx.fillText(tagLines[0], 0, 0);
      ctx.fillText(tagLines[1], 8, FMT.tagSize + 2);
      ctx.restore();
    }

    // ---- Faixa de números ----
    drawCardBox(ctx, M, statsTop, CW, FMT.statsH, 16, hexA('#000000', 0.38), hexA(AMBER, 0.45), 1.2);
    var colW = CW / 4;
    var stats = [
      { icon: 'clapper', v: String(d.monthMovies.length), l: (d.monthMovies.length === 1 ? 'filme em ' : 'filmes em ') + d.monthName, s: d.totalMovies + ' no total' },
      { icon: 'tv', v: String(d.monthSeries.length), l: (d.monthSeries.length === 1 ? 'série em ' : 'séries em ') + d.monthName, s: d.totalSeries + ' no total' },
      { icon: 'clock', v: d.monthMinutes ? formatDuration(d.monthMinutes) : '—', l: 'de filmes no mês', s: d.movieMinutes ? formatDuration(d.movieMinutes) + ' no total' : '' },
      { icon: 'play', v: d.totalEpisodes ? d.totalEpisodes.toLocaleString('pt-BR') : '—', l: 'episódios assistidos', s: d.seriesMinutes ? formatDuration(d.seriesMinutes) + ' de séries' : '' }
    ];
    stats.forEach(function (st, i) {
      var x = M + i * colW;
      if (i) { ctx.fillStyle = hexA(AMBER, 0.28); ctx.fillRect(x, statsTop + 14, 1, FMT.statsH - 28); }
      var cx0 = x + 16;
      var vSize = FMT.statsStack ? 42 : 36;
      var vX = FMT.statsStack ? cx0 : cx0 + 34;
      var vMax = colW - 16 - (vX - x) - 8;
      var vTxt = st.v.toUpperCase();
      ctx.font = vSize + 'px ' + SHARE.DISPLAY;
      while (vSize > 24 && ctx.measureText(vTxt).width > vMax) { vSize -= 2; ctx.font = vSize + 'px ' + SHARE.DISPLAY; }
      var iconR = FMT.statsStack ? 17 : 14;
      var iy, vy, ly, sy;
      if (FMT.statsStack) { iy = statsTop + 14 + iconR; vy = statsTop + 90; ly = statsTop + 106; sy = statsTop + 121; }
      else { iy = statsTop + 12 + iconR; vy = statsTop + 12 + iconR + 12; ly = statsTop + 62; sy = statsTop + 77; }
      ctx.beginPath(); ctx.arc(cx0 + iconR, iy, iconR, 0, Math.PI * 2); ctx.fillStyle = AMBER; ctx.fill();
      drawIcon(ctx, st.icon, cx0 + iconR, iy, iconR * 1.15, '#1b140d', AMBER);
      ctx.fillStyle = '#ffffff';
      ctx.font = vSize + 'px ' + SHARE.DISPLAY;
      ctx.fillText(vTxt, vX, vy);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = '400 ' + (FMT.statsStack ? 12.5 : 11.5) + 'px ' + SHARE.BODY;
      ctx.fillText(ellipsize(ctx, st.l.toUpperCase(), colW - 24), cx0, ly);
      if (st.s) {
        ctx.fillStyle = AMBER;
        ctx.font = '600 ' + (FMT.statsStack ? 12.5 : 11.5) + 'px ' + SHARE.BODY;
        ctx.fillText(ellipsize(ctx, st.s, colW - 24), cx0, sy);
      }
    });

    // ---- Destaques do mês ----
    if (heroes.length) {
      drawSection(ctx, 'crown', 'DESTAQUES DO MÊS', M, statsBottom + FMT.gap, CW, FMT.secH, FMT.secFont);
      if (twoUp) {
        var gapH = 14, bw2 = Math.floor((CW - gapH) / 2);
        heroes.forEach(function (h, i) {
          drawHeroCard(ctx, h.e, heroImgs[i], h.label, h.icon, M + i * (bw2 + gapH), heroTop, bw2, FMT.heroH, { pill: FMT.heroPill, genres: false, big: false, sizes: [40, 34, 30, 26, 22] });
        });
      } else {
        drawHeroCard(ctx, heroes[0].e, heroImgs[0], heroes[0].label, heroes[0].icon, M, heroTop, CW, FMT.heroH, { pill: FMT.heroPill, genres: true, big: true, sizes: [58, 50, 44, 38, 32] });
      }
    }

    // ---- Este mês: cards de pôster com borda pela nota ----
    drawSection(ctx, 'reel', 'ESTE MÊS', M, monthSecTop, CW, FMT.secH, FMT.secFont);
    if (n === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '400 20px ' + SHARE.BODY;
      ctx.textAlign = 'center';
      ctx.fillText('Nada registrado este mês ainda.', W / 2, gridTop + gridH / 2);
      ctx.textAlign = 'left';
    }
    var total = shown.length + (overflow ? 1 : 0);
    var usedRows = Math.max(1, Math.ceil(total / perRow));
    var gridOff = Math.max(0, Math.floor((gridH - (usedRows * ch + (usedRows - 1) * GAP)) / 2));
    for (var q = 0; q < total; q++) {
      var col = q % perRow, row = Math.floor(q / perRow);
      var px = M + col * (tw + GAP), py = gridTop + gridOff + row * (ch + GAP);
      if (q >= shown.length) {
        drawCardBox(ctx, px, py, tw, ch, 8, 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.2)', 1.5);
        ctx.fillStyle = '#ffffff';
        ctx.font = Math.round(ch * 0.3) + 'px ' + SHARE.DISPLAY;
        ctx.textAlign = 'center';
        ctx.fillText('+' + overflow, px + tw / 2, py + ch / 2 + ch * 0.1);
        ctx.textAlign = 'left';
        continue;
      }
      var e = shown[q], tb = badgeFor(e);
      var border = tb ? tb.color : 'rgba(255,255,255,0.22)';
      drawCardBox(ctx, px, py, tw, ch, 8, hexA('#000000', 0.4), border, 2);
      var pw = tw - 2 * PAD, ph = Math.round(pw * 1.5);
      drawPoster(ctx, e, tileImgs[q], px + PAD, py + PAD, pw, ph, 6);
      var nr = tw >= 70 ? 11 : 9;
      ctx.beginPath(); ctx.arc(px + PAD + nr + 3, py + PAD + nr + 3, nr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(18,14,10,0.88)'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = AMBER; ctx.stroke();
      ctx.fillStyle = AMBER;
      ctx.font = (nr >= 11 ? 15 : 12) + 'px ' + SHARE.DISPLAY;
      ctx.textAlign = 'center';
      ctx.fillText(String(q + 1), px + PAD + nr + 3, py + PAD + nr + 3 + (nr >= 11 ? 5 : 4));
      ctx.textAlign = 'left';
      if (withText) {
        var fs = 17;
        var ttl = String(e.title || '').toUpperCase();
        ctx.font = fs + 'px ' + SHARE.DISPLAY;
        while (fs > 12 && ctx.measureText(ttl).width > tw - 12) { fs -= 1; ctx.font = fs + 'px ' + SHARE.DISPLAY; }
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(ellipsize(ctx, ttl, tw - 12), px + tw / 2, py + PAD + ph + 18);
        if (num(e.rating) > 0) {
          var sc2 = formatRating(e.rating);
          ctx.font = '700 15px ' + SHARE.BODY;
          var w1 = ctx.measureText(sc2).width;
          ctx.font = '400 12px ' + SHARE.BODY;
          var w2 = ctx.measureText('/10').width;
          var sx = px + tw / 2 - (16 + w1 + w2) / 2;
          drawStar(ctx, sx + 6, py + PAD + ph + 32, 6.5, tb ? tb.color : AMBER);
          ctx.textAlign = 'left';
          ctx.fillStyle = '#ffffff';
          ctx.font = '700 15px ' + SHARE.BODY;
          ctx.fillText(sc2, sx + 16, py + PAD + ph + 37);
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.font = '400 12px ' + SHARE.BODY;
          ctx.fillText('/10', sx + 16 + w1, py + PAD + ph + 37);
        }
        ctx.textAlign = 'left';
      } else if (tb) {
        var br = Math.max(9, Math.min(15, Math.round(tw * 0.15)));
        drawBadge(ctx, tb, px + tw - PAD - br - 2, py + PAD + br + 2, br);
      }
    }

    // ---- Legenda dos selos ----
    var counts = {};
    shown.forEach(function (e) { var b = badgeFor(e); if (b) counts[b.key] = (counts[b.key] || 0) + 1; });
    if (FMT.legendCard) {
      drawCardBox(ctx, M, legendTop, CW, legendH, 16, hexA('#000000', 0.38), hexA(AMBER, 0.4), 1.2);
      var lw3 = CW / 3;
      ['skip', 'rec', 'must'].forEach(function (k, i) {
        var b = BADGES[k], x = M + i * lw3;
        if (i) { ctx.fillStyle = hexA(AMBER, 0.28); ctx.fillRect(x, legendTop + 14, 1, legendH - 28); }
        var ix = x + 16 + 21, iy2 = legendTop + 36;
        ctx.beginPath(); ctx.arc(ix, iy2, 21, 0, Math.PI * 2);
        ctx.fillStyle = hexA(b.color, 0.12); ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = b.color; ctx.stroke();
        drawIcon(ctx, b.icon, ix, iy2, 24, b.color, '#1b140d');
        var lx2 = x + 16 + 42 + 12, lmax = lw3 - 16 - 42 - 12 - 10;
        ctx.fillStyle = b.color;
        ctx.font = '22px ' + SHARE.DISPLAY;
        var rg = b.range.toUpperCase();
        ctx.fillText(rg, lx2, legendTop + 30);
        if (counts[k]) {
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.font = '700 13px ' + SHARE.BODY;
          ctx.fillText('· ' + counts[k], lx2 + (function () { ctx.font = '22px ' + SHARE.DISPLAY; return ctx.measureText(rg).width; })() + 8, legendTop + 29);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = '400 13.5px ' + SHARE.BODY;
        wrapLines(ctx, b.label, lmax).slice(0, 2).forEach(function (ln, j) { ctx.fillText(ln, lx2, legendTop + 49 + j * 16); });
        drawCardBox(ctx, x + 16, legendTop + legendH - 14, lw3 - 32, 4, 2, b.color, null);
      });
    } else if (Object.keys(counts).length) {
      var lx = M, ly = legendTop + 19;
      ['must', 'rec', 'skip'].forEach(function (k) {
        if (!counts[k]) return;
        var b = BADGES[k];
        drawBadge(ctx, b, lx + 10, ly - 5, 10);
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        ctx.font = '400 14px ' + SHARE.BODY;
        ctx.fillText(b.label, lx + 28, ly);
        var lw = ctx.measureText(b.label).width;
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 14px ' + SHARE.BODY;
        ctx.fillText(String(counts[k]), lx + 28 + lw + 6, ly);
        lx += 28 + lw + 6 + ctx.measureText(String(counts[k])).width + 22;
      });
    }

    // ---- Rodapé: marca e frase ----
    drawIcon(ctx, 'clapper', M + 13, footerBase - 9, 26, AMBER, '#15110d');
    ctx.fillStyle = AMBER;
    ctx.font = '26px ' + SHARE.DISPLAY;
    ctx.fillText('WANDCINE', M + 34, footerBase);
    var brandEnd = M + 34 + ctx.measureText('WANDCINE').width;
    ctx.font = '600 ' + (FMT.tagSize + 1) + 'px ' + SHARE.SCRIPT;
    var foot = 'Bons filmes fazem grandes dias.';
    var footW = ctx.measureText(foot).width;
    var lineEnd = brandEnd + 24 + 80 <= W - M - footW - 16 ? W - M - footW - 16 : W - M;
    ctx.fillStyle = hexA(AMBER, 0.4);
    ctx.fillRect(brandEnd + 16, footerBase - 8, Math.max(0, lineEnd - brandEnd - 16), 1);
    if (lineEnd < W - M) {
      ctx.fillStyle = AMBER;
      ctx.font = '600 ' + (FMT.tagSize + 1) + 'px ' + SHARE.SCRIPT;
      ctx.fillText(foot, W - M - footW, footerBase - 2);
    }

    // Saída final: exatamente 800x800 ou 800x1000 (desenhado em 2x e reduzido para ficar nítido)
    var out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    var octx = out.getContext('2d');
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(big, 0, 0, W, H);
    return new Promise(function (resolve) { out.toBlob(resolve, 'image/png'); });
  }

  function recapFileName() {
    return 'wandcine-' + new Date().toISOString().slice(0, 7) + '-' + SHARE_FORMATS[shareFormat].label.replace('×', 'x') + '.png';
  }

  async function downloadRecapImage() {
    var btn = document.getElementById('recap-image-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Gerando…'; }
    try {
      var blob = await buildShareImage();
      if (!blob) throw new Error('sem imagem');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = recapFileName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      showToast('Imagem salva!');
    } catch (err) {
      showToast('Não foi possível gerar a imagem.');
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Baixar imagem'; }
  }

  function pickShareBg() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      showToast('Enviando fundo…');
      api('PUT', '/api/share-bg', undefined, f).then(function (r) {
        shareBgVersion = r.shareBg;
        renderShare();
        showToast('Fundo atualizado. A próxima imagem já usa ele.');
      }).catch(function (err) { showToast('Não foi possível enviar o fundo: ' + err.message); });
    });
    input.click();
  }

  // ---- Logo ----
  function applyLogo(version) {
    var on = !!version;
    logoVersion = version || null;
    document.getElementById('brand-logo').classList.toggle('hidden', !on);
    document.getElementById('brand-default').classList.toggle('hidden', on);
    document.getElementById('logo-btn').textContent = on ? 'Trocar logo' : 'Definir logo';
    var ic = document.querySelector('link[rel="icon"]');
    if (on) {
      document.getElementById('brand-logo-img').src = '/logo?v=' + version;
      if (ic) { ic.type = 'image/png'; ic.href = '/logo?v=' + version; }
    } else if (ic) { ic.type = 'image/svg+xml'; ic.href = '/favicon.svg'; }
  }

  // Reduz a imagem para um quadrado de 512 px (PNG) antes de enviar: carrega rápido e vale também como ícone da aba.
  function squareLogoBlob(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var side = Math.min(img.width, img.height), SIZE = 512;
        var c = document.createElement('canvas');
        c.width = SIZE; c.height = SIZE;
        var ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('Não foi possível ler a imagem.')); }, 'image/png');
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler a imagem.')); };
      img.src = url;
    });
  }

  function pickLogo() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      showToast('Enviando logo…');
      squareLogoBlob(f).then(function (blob) {
        return api('PUT', '/api/logo', undefined, blob);
      }).then(function (r) {
        applyLogo(r.logo);
        showToast('Logo atualizada.');
      }).catch(function (err) { showToast('Não foi possível enviar a logo: ' + err.message); });
    });
    input.click();
  }

  function removeShareBg() {
    api('DELETE', '/api/share-bg').then(function () {
      shareBgVersion = null;
      renderShare();
      showToast('Fundo removido.');
    }).catch(function (err) { showToast(err.message); });
  }

  async function shareRecapImage() {
    try {
      var blob = await buildShareImage();
      var file = new File([blob], recapFileName(), { type: 'image/png' });
      await navigator.share({ files: [file], title: 'WAndCine' });
    } catch (err) {
      if (!err || err.name !== 'AbortError') showToast('Não foi possível compartilhar.');
    }
  }

  function render() {
    renderTabs();
    renderShare();
    if (state.activeTab === 'share') return;
    renderStats();
    renderGenreBreakdown();
    renderList();
  }

  function fieldForType(type, existing) {
    existing = existing || {};
    var rating = Math.round(num(existing.rating));
    var starsHtml = '';
    for (var i = 1; i <= 10; i++) {
      starsHtml += '<button type="button" data-val="' + i + '" class="' + (i <= rating ? 'filled' : '') + '" title="Nota ' + i + '" aria-label="Nota ' + i + '">★</button>';
    }
    var extraField = '';
    if (type === 'movie') {
      extraField =
        '<div class="form-field"><label>Ano de lançamento</label>' +
        '<input type="number" name="year" value="' + escapeHtml(existing.year || '') + '" placeholder="Ex: 1999"></div>' +
        '<div class="form-field"><label>Duração (minutos)</label>' +
        '<input type="number" name="duration" min="0" value="' + escapeHtml(existing.duration || '') + '" placeholder="Ex: 142"></div>' +
        '<div class="form-field"><label>Gênero(s)</label>' +
        '<input type="text" name="genres" value="' + escapeHtml((existing.genres || []).join(', ')) + '" placeholder="Ex: Ação, Ficção Científica"></div>';
    } else {
      extraField =
        '<div class="form-field"><label>Temporadas assistidas</label>' +
        '<input type="text" name="extra" value="' + escapeHtml(existing.extra || '') + '" placeholder="Ex: 3 de 5"></div>' +
        '<div class="form-field"><label>Status</label><select name="status">' +
        STATUS.series.map(function (s) { return '<option ' + (existing.status === s ? 'selected' : '') + '>' + s + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="form-field"><label>Episódios assistidos</label>' +
        '<input type="number" name="episodes" min="0" value="' + escapeHtml(existing.episodes || '') + '" placeholder="Ex: 12"></div>' +
        '<div class="form-field"><label>Tempo assistido (minutos)</label>' +
        '<input type="number" name="duration" min="0" value="' + escapeHtml(existing.duration || '') + '" placeholder="Ex: 480"></div>';
    }
    var coverFieldHtml =
      '<div class="form-field cover-field">' +
        '<label>Capa (imagem)</label>' +
        (existing.coverUrl ? '<img class="cover-preview" src="' + escapeHtml(existing.coverUrl) + '" alt="Capa atual">' : '') +
        '<input type="file" accept="image/*" name="cover">' +
        '<input type="hidden" name="removeCover" value="0">' +
        (existing.coverUrl ? '<button type="button" class="btn-secondary" id="remove-cover-btn" style="margin-top:6px;">Remover capa</button>' : '') +
      '</div>';

    var imdbFieldHtml =
      '<div class="form-field"><label>IMDb (URL ou ID)</label>' +
      '<input type="text" name="imdbUrl" value="' + escapeHtml(existing.imdbUrl || '') + '" placeholder="https://www.imdb.com/title/... ou tt0111161"></div>';

    return (
      '<div class="form-grid">' +
        '<div class="form-field"><label>Título</label>' +
        '<input type="text" name="title" value="' + escapeHtml(existing.title || '') + '" placeholder="Nome do ' + LABELS[type].name + '" required></div>' +
        extraField +
        '<div class="form-field"><label>' + (type === 'movie' ? 'Assistido em' : 'Atualizado em') + '</label>' +
        '<input type="date" name="date" value="' + escapeHtml(existing.date || '') + '"></div>' +
        '<div class="form-field form-field--rating"><label>Nota <span class="rating-readout" id="rating-readout">' + (rating ? rating + '/10' : 'sem nota') + '</span></label><div class="star-input" id="star-input">' + starsHtml + '</div>' +
        '<input type="hidden" name="rating" value="' + rating + '"></div>' +
        imdbFieldHtml +
        coverFieldHtml +
      '</div>' +
      '<div class="form-field" style="margin-top:12px;"><label>Anotações</label>' +
      '<textarea name="notes" placeholder="Impressões, lembranças, o que quiser anotar…">' + escapeHtml(existing.notes || '') + '</textarea></div>'
    );
  }

  function openForm(existing) {
    state.formOpen = true;
    state.editingId = existing ? existing.id : null;
    var panel = document.getElementById('form-panel');
    var type = existing ? existing.type : state.activeTab;
    panel.innerHTML =
      '<div class="modal-head">' +
        '<h2 id="modal-title">' + (existing ? 'Editar ' : 'Adicionar ') + LABELS[type].name + '</h2>' +
        '<button type="button" class="modal-x" id="modal-close" aria-label="Fechar">✕</button>' +
      '</div>' +
      '<form id="entry-form">' +
        fieldForType(type, existing) +
        '<p class="form-error hidden" id="form-error" role="alert"></p>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn-secondary" id="cancel-form">Cancelar</button>' +
          '<button type="submit" class="btn-primary">Salvar</button>' +
        '</div>' +
      '</form>';
    panel.dataset.type = type;
    if (!panel.open) panel.showModal();
    panel.scrollTop = 0;

    panel.querySelectorAll('.star-input button').forEach(function (b) {
      b.addEventListener('click', function () {
        var val = parseInt(b.dataset.val, 10);
        var hidden = panel.querySelector('input[name="rating"]');
        // Clicar de novo na nota atual remove a nota.
        var newVal = (parseInt(hidden.value, 10) === val) ? 0 : val;
        hidden.value = newVal;
        panel.querySelectorAll('.star-input button').forEach(function (bb) {
          bb.classList.toggle('filled', parseInt(bb.dataset.val, 10) <= newVal);
        });
        panel.querySelector('#rating-readout').textContent = newVal ? newVal + '/10' : 'sem nota';
      });
    });

    var removeCoverBtn = panel.querySelector('#remove-cover-btn');
    if (removeCoverBtn) {
      removeCoverBtn.addEventListener('click', function () {
        panel.querySelector('input[name="removeCover"]').value = '1';
        var preview = panel.querySelector('.cover-preview');
        if (preview) preview.remove();
        removeCoverBtn.remove();
      });
    }
    var coverFileInput = panel.querySelector('input[name="cover"]');
    coverFileInput.addEventListener('change', function () {
      if (!coverFileInput.files || !coverFileInput.files[0]) return;
      var url = URL.createObjectURL(coverFileInput.files[0]);
      var preview = panel.querySelector('.cover-preview');
      if (!preview) {
        preview = document.createElement('img');
        preview.className = 'cover-preview';
        coverFileInput.parentNode.insertBefore(preview, coverFileInput);
      }
      preview.src = url;
      panel.querySelector('input[name="removeCover"]').value = '0';
    });

    document.getElementById('cancel-form').addEventListener('click', closeForm);
    document.getElementById('modal-close').addEventListener('click', closeForm);
    document.getElementById('entry-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      saveForm(type);
    });

    // Novo registro: já cursor no título. Edição: sem teclado aberto no celular.
    if (!existing) {
      var titleInput = panel.querySelector('input[name="title"]');
      if (titleInput) titleInput.focus();
    }
  }

  function closeForm() {
    var panel = document.getElementById('form-panel');
    if (panel.open) panel.close();
    state.formOpen = false;
    state.editingId = null;
    panel.innerHTML = '';
  }

  // Esc (ou qualquer fechamento do diálogo) também zera o estado do formulário.
  document.getElementById('form-panel').addEventListener('close', function () {
    state.formOpen = false;
    state.editingId = null;
    this.innerHTML = '';
  });

  function normalizeImdbInput(raw) {
    raw = (raw || '').toString().trim();
    if (!raw) return '';
    var idMatch = raw.match(/tt\d{6,9}/i);
    if (/^tt\d{6,9}$/i.test(raw)) {
      return 'https://www.imdb.com/title/' + raw.toLowerCase() + '/';
    }
    if (/^https?:\/\//i.test(raw)) {
      return raw;
    }
    if (raw.toLowerCase().indexOf('imdb.com') !== -1) {
      return 'https://' + raw.replace(/^\/+/, '');
    }
    if (idMatch) {
      return 'https://www.imdb.com/title/' + idMatch[0].toLowerCase() + '/';
    }
    return raw;
  }

  // ---- Detalhes do filme/série (sinopse, elenco, onde assistir via TMDB) ----
  var detailCache = {};

  function detailRow(label, html) {
    return html ? '<section class="detail-row"><h4>' + label + '</h4>' + html + '</section>' : '';
  }

  function detailExtraHtml(d) {
    var out = '';
    if (d.tagline) out += '<p class="detail-tagline">“' + escapeHtml(d.tagline) + '”</p>';
    out += detailRow('Sinopse', d.overview ? '<p>' + escapeHtml(d.overview) + '</p>' : '<p class="detail-muted">Sem sinopse disponível.</p>');
    if (d.originalTitle && d.title && d.originalTitle !== d.title) {
      out += detailRow('Título original', '<p>' + escapeHtml(d.originalTitle) + '</p>');
    }
    if (d.directors && d.directors.length) {
      out += detailRow(d.kind === 'tv' ? 'Criação' : 'Direção', '<p>' + d.directors.map(escapeHtml).join(', ') + '</p>');
    }
    if (d.cast && d.cast.length) {
      out += detailRow('Elenco', '<ul class="detail-cast">' + d.cast.map(function (c) {
        return '<li><b>' + escapeHtml(c.name) + '</b>' + (c.character ? '<span>' + escapeHtml(c.character) + '</span>' : '') + '</li>';
      }).join('') + '</ul>');
    }
    var pv = d.providers;
    var pvHtml = '';
    if (pv) {
      [['flatrate', 'Streaming'], ['rent', 'Aluguel'], ['buy', 'Compra']].forEach(function (g) {
        if (pv[g[0]] && pv[g[0]].length) {
          pvHtml += '<p><span class="detail-chip-label">' + g[1] + '</span> ' + pv[g[0]].map(escapeHtml).join(', ') + '</p>';
        }
      });
    }
    out += detailRow('Onde assistir (Brasil)', (pvHtml || '<p class="detail-muted">Sem informação de streaming para o Brasil.</p>') +
      '<p class="detail-attrib">Dados de streaming: JustWatch, via TMDB.</p>');
    return out;
  }

  function loadDetails(entry, panel) {
    var box = panel.querySelector('#detail-extra');
    if (!entry.imdbUrl) {
      box.innerHTML = '<p class="detail-muted">Adicione o link ou o código do IMDb a este registro para ver sinopse, elenco e onde assistir.</p>';
      return;
    }
    if (!coversEnabled) {
      box.innerHTML = '<p class="detail-muted">Para ver sinopse, elenco e onde assistir, ative o TMDB no servidor (TMDB_API_KEY).</p>';
      return;
    }
    var apply = function (d) {
      if (!panel.open || panel.dataset.id !== entry.id) return;
      box.innerHTML = detailExtraHtml(d);
      var score = panel.querySelector('#detail-tmdb-score');
      if (score && d.voteAverage) { score.textContent = 'TMDB ' + String(d.voteAverage).replace('.', ','); score.classList.remove('hidden'); }
      var link = panel.querySelector('#detail-tmdb-link');
      if (link && /^https:\/\/www\.themoviedb\.org\//.test(d.tmdbUrl || '')) { link.href = d.tmdbUrl; link.classList.remove('hidden'); }
    };
    if (detailCache[entry.id]) { apply(detailCache[entry.id]); return; }
    api('GET', '/api/entries/' + encodeURIComponent(entry.id) + '/details').then(function (d) {
      detailCache[entry.id] = d;
      apply(d);
    }).catch(function (err) {
      if (!panel.open || panel.dataset.id !== entry.id) return;
      box.innerHTML = '<p class="detail-muted">' + escapeHtml(err.message) + '</p>';
    });
  }

  function openDetail(entry) {
    var panel = document.getElementById('detail-panel');
    panel.dataset.id = entry.id;
    var meta = metaLine(entry);
    if (entry.date) meta += (meta ? ' · ' : '') + (entry.type === 'movie' ? 'assistido em ' : 'atualizado em ') + formatDate(entry.date);
    var poster = entry.coverUrl
      ? '<div class="detail-poster" style="background-image:url(&quot;' + escapeHtml(entry.coverUrl) + '&quot;)"></div>'
      : '<div class="detail-poster poster-placeholder" style="' + posterPlaceholder(entry) + '"><span class="poster-initial">' + escapeHtml((entry.title || '?').trim().charAt(0).toUpperCase()) + '</span></div>';
    var genres = (entry.genres || []).map(function (g) { return '<span class="genre-tag">' + escapeHtml(g) + '</span>'; }).join('');
    var imdbOk = /^https?:\/\//i.test(entry.imdbUrl || '');
    panel.innerHTML =
      '<div class="modal-head">' +
        '<h2 id="detail-title">' + escapeHtml(entry.title) + '</h2>' +
        '<button type="button" class="modal-x" data-detail="close" aria-label="Fechar">✕</button>' +
      '</div>' +
      '<div class="detail-top">' + poster +
        '<div class="detail-info">' +
          (meta ? '<p class="detail-meta">' + meta + '</p>' : '') +
          (genres ? '<div class="genre-tags">' + genres + '</div>' : '') +
          '<p class="detail-scores">' +
            (entry.rating ? '<span class="detail-score">★ ' + formatRating(entry.rating) + '<small>/10</small></span><span class="detail-score-label">sua nota</span>' : '<span class="detail-muted">Sem nota</span>') +
            '<span class="detail-chip hidden" id="detail-tmdb-score"></span>' +
          '</p>' +
        '</div>' +
      '</div>' +
      '<div id="detail-extra"><p class="detail-muted">Carregando detalhes…</p></div>' +
      (entry.notes ? detailRow('Minhas anotações', '<p class="detail-notes">' + escapeHtml(entry.notes) + '</p>') : '') +
      '<div class="detail-actions">' +
        '<button type="button" class="btn-secondary" data-detail="edit">Editar</button>' +
        (imdbOk ? '<a class="btn-secondary" href="' + escapeHtml(entry.imdbUrl) + '" target="_blank" rel="noopener">IMDb ↗</a>' : '') +
        '<a class="btn-secondary hidden" id="detail-tmdb-link" href="#" target="_blank" rel="noopener">TMDB ↗</a>' +
        '<button type="button" class="btn-primary" data-detail="close">Fechar</button>' +
      '</div>';
    if (!panel.open) panel.showModal();
    panel.scrollTop = 0;
    loadDetails(entry, panel);
  }

  function closeDetail() {
    var panel = document.getElementById('detail-panel');
    if (panel.open) panel.close();
  }

  (function () {
    var panel = document.getElementById('detail-panel');
    panel.addEventListener('close', function () { panel.innerHTML = ''; panel.dataset.id = ''; });
    panel.addEventListener('click', function (e) {
      if (e.target === panel) { closeDetail(); return; } // clique no fundo escurecido
      var b = e.target.closest('[data-detail]');
      if (!b) return;
      if (b.dataset.detail === 'close') closeDetail();
      if (b.dataset.detail === 'edit') {
        var entry = entries.find(function (x) { return x.id === panel.dataset.id; });
        closeDetail();
        if (entry) openForm(entry);
      }
    });
  })();

  async function saveForm(type) {
    var form = document.getElementById('entry-form');
    var submitBtn = form.querySelector('button[type="submit"]');
    var fd = new FormData(form);
    var title = (fd.get('title') || '').toString().trim();
    if (!title) return;

    var payload = {
      type: type,
      title: title,
      date: fd.get('date') || '',
      rating: parseInt(fd.get('rating'), 10) || 0,
      notes: (fd.get('notes') || '').toString().trim(),
      imdbUrl: normalizeImdbInput(fd.get('imdbUrl'))
    };
    if (type === 'movie') {
      payload.year = (fd.get('year') || '').toString().trim();
      payload.duration = parseInt(fd.get('duration'), 10) || 0;
      payload.genres = (fd.get('genres') || '').toString().split(',').map(function (g) { return g.trim(); }).filter(Boolean);
    } else {
      payload.extra = (fd.get('extra') || '').toString().trim();
      payload.status = fd.get('status');
      payload.episodes = parseInt(fd.get('episodes'), 10) || 0;
      payload.duration = parseInt(fd.get('duration'), 10) || 0;
    }

    var removeCover = fd.get('removeCover') === '1';
    var fileInput = form.querySelector('input[name="cover"]');
    var file = fileInput && fileInput.files && fileInput.files[0];
    var editingId = state.editingId;

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Salvando…'; }
    try {
      var saved = editingId ? await api('PUT', '/api/entries/' + encodeURIComponent(editingId), payload)
                            : await api('POST', '/api/entries', payload);
      if (file) {
        try {
          saved = await api('PUT', '/api/entries/' + encodeURIComponent(saved.id) + '/cover', undefined, file);
        } catch (err) {
          showToast('Registro salvo, mas a capa não foi enviada: ' + err.message);
        }
      } else if (removeCover && saved.coverId) {
        saved = await api('DELETE', '/api/entries/' + encodeURIComponent(saved.id) + '/cover');
      }
      var idx = entries.findIndex(function (e) { return e.id === saved.id; });
      if (idx !== -1) entries[idx] = saved; else entries.push(saved);
      closeForm();
      render();
      showToast('Salvo.');
    } catch (err) {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Salvar'; }
      // O toast fica atrás do diálogo; o erro aparece dentro dele.
      var fe = document.getElementById('form-error');
      if (fe) { fe.textContent = 'Não foi possível salvar: ' + err.message; fe.classList.remove('hidden'); }
      else showToast('Não foi possível salvar: ' + err.message);
    }
  }

  async function deleteEntry(id) {
    try {
      await api('DELETE', '/api/entries/' + encodeURIComponent(id));
      entries = entries.filter(function (e) { return e.id !== id; });
      render();
      showToast('Removido.');
    } catch (err) {
      showToast('Não foi possível excluir: ' + err.message);
    }
  }

  document.querySelectorAll('.tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.activeTab = btn.dataset.type;
      state.search = '';
      state.genreFilter = null;
      state.ratingFilter = 'all';
      document.getElementById('search-input').value = '';
      document.getElementById('rating-filter').value = 'all';
      closeForm();
      render();
    });
  });

  document.getElementById('share-view').addEventListener('click', function (e) {
    var fmtBtn = e.target.closest('[data-fmt]');
    if (fmtBtn && SHARE_FORMATS[fmtBtn.dataset.fmt]) {
      shareFormat = fmtBtn.dataset.fmt;
      try { localStorage.setItem('wandcine.shareFormat', shareFormat); } catch (_) { /* sem armazenamento */ }
      renderShare();
      return;
    }
    if (e.target.closest('#recap-copy-btn')) { copyRecapText(); return; }
    if (e.target.closest('#recap-image-btn')) { downloadRecapImage(); return; }
    if (e.target.closest('#recap-share-btn')) { shareRecapImage(); return; }
    if (e.target.closest('#recap-bg-btn')) { pickShareBg(); return; }
    if (e.target.closest('#recap-bg-remove')) { removeShareBg(); return; }
  });

  document.getElementById('genre-breakdown').addEventListener('click', function (e) {
    var clearBtn = e.target.closest('#genre-clear-btn');
    if (clearBtn) {
      state.genreFilter = null;
      renderGenreBreakdown();
      renderList();
      return;
    }
    var toggleHead = e.target.closest('#genre-breakdown-toggle');
    if (toggleHead) {
      state.genreBreakdownCollapsed = !state.genreBreakdownCollapsed;
      renderGenreBreakdown();
      return;
    }
    var row = e.target.closest('[data-genre]');
    if (!row) return;
    var genre = row.dataset.genre;
    state.genreFilter = (state.genreFilter === genre) ? null : genre;
    renderGenreBreakdown();
    renderList();
  });

  document.getElementById('search-input').addEventListener('input', function (e) {
    state.search = e.target.value;
    renderList();
  });

  document.getElementById('rating-filter').addEventListener('change', function (e) {
    state.ratingFilter = e.target.value;
    renderList();
  });

  document.getElementById('filter-summary').addEventListener('click', function (e) {
    if (!e.target.closest('#filter-clear-btn')) return;
    state.ratingFilter = 'all';
    state.genreFilter = null;
    state.search = '';
    document.getElementById('rating-filter').value = 'all';
    document.getElementById('search-input').value = '';
    renderGenreBreakdown();
    renderList();
  });

  document.getElementById('sort-select').addEventListener('change', function (e) {
    state.sort = e.target.value;
    renderList();
  });

  document.getElementById('add-btn').addEventListener('click', function () {
    openForm(null);
  });

  document.getElementById('list').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    var card = e.target.closest('.card');
    if (!card) return;
    var id = card.dataset.id;
    var entry = entries.find(function (x) { return x.id === id; });
    if (!entry) return;
    if (!btn) {
      if (e.target.closest('a')) return; // o link do IMDb abre sozinho
      openDetail(entry);
      return;
    }
    if (btn.dataset.action === 'edit') {
      openForm(entry);
    } else if (btn.dataset.action === 'delete') {
      if (confirm('Excluir "' + entry.title + '"?')) deleteEntry(id);
    }
  });

  // Teclado: Enter ou Espaço no pôster abre os detalhes.
  document.getElementById('list').addEventListener('keydown', function (e) {
    if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.classList.contains('poster')) return;
    e.preventDefault();
    var card = e.target.closest('.card');
    var entry = card && entries.find(function (x) { return x.id === card.dataset.id; });
    if (entry) openDetail(entry);
  });

  document.getElementById('logo-btn').addEventListener('click', pickLogo);

  // ---- Instalar como app (PWA) ----
  var installBtn = document.getElementById('install-btn');
  var installPrompt = null;
  var isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  if (!isStandalone) {
    window.addEventListener('beforeinstallprompt', function (ev) {
      ev.preventDefault();
      installPrompt = ev;
      installBtn.classList.remove('hidden');
    });
    if (isIos) installBtn.classList.remove('hidden');
  }
  window.addEventListener('appinstalled', function () { installBtn.classList.add('hidden'); installPrompt = null; });
  installBtn.addEventListener('click', function () {
    if (installPrompt) {
      installPrompt.prompt();
      installPrompt.userChoice.then(function () { installPrompt = null; installBtn.classList.add('hidden'); });
    } else if (isIos) {
      showToast('No iPhone: toque em Compartilhar e depois em "Adicionar à Tela de Início".');
    }
  });
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
  document.getElementById('logout-btn').addEventListener('click', function () {
    fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).finally(function () { location.replace('/login'); });
  });

  var coversBusy = false;
  function syncCovers() {
    if (coversBusy) return;
    coversBusy = true;
    var btn = document.getElementById('covers-btn');
    btn.disabled = true;
    var label = btn.textContent;
    function finish(msg) {
      coversBusy = false;
      btn.disabled = false;
      btn.textContent = label;
      if (msg) showToast(msg);
    }
    api('POST', '/api/covers/sync').then(function poll(st) {
      if (st.error) { finish('Capas: ' + st.error); return; }
      if (st.running || (st.total > 0 && st.done < st.total && !st.error)) {
        btn.textContent = 'Buscando… ' + st.done + '/' + st.total;
        setTimeout(function () {
          api('GET', '/api/covers/sync').then(poll).catch(function (e) { finish(e.message); });
        }, 1500);
        return;
      }
      api('GET', '/api/entries').then(function (list) {
        entries = visible(list);
        render();
        finish(st.total === 0 ? 'Nenhuma capa pendente.' :
          st.found + ' capas encontradas' + (st.missing ? ', ' + st.missing + ' sem pôster no TMDB' : '') + (st.failed ? ', ' + st.failed + ' com erro' : '') + '.');
      });
    }).catch(function (e) { finish('Não foi possível buscar capas: ' + e.message); });
  }
  document.getElementById('covers-btn').addEventListener('click', syncCovers);

  function showImportResult(r, list) {
    var el = document.getElementById('import-result');
    el.classList.remove('hidden');
    el.classList.toggle('error', !!r.error);
    if (r.error) {
      el.innerHTML = '<h3>Não foi possível importar</h3><p>' + escapeHtml(r.error) + '</p><button type="button" class="btn-secondary" id="import-close">Fechar</button>';
    } else {
      var n = function (t) { return list.filter(function (e) { return e.type === t; }).length; };
      var types = Object.keys(r.skippedTypes || {}).map(function (k) { return escapeHtml(k) + ': ' + r.skippedTypes[k]; }).join(', ');
      var li = [
        '<li>Linhas lidas no arquivo: <b>' + r.rows + '</b></li>',
        '<li>Novos no catálogo: <b>' + r.created + '</b></li>',
        '<li>Já existiam e foram atualizados: <b>' + r.updated + '</b></li>'
      ];
      var ign = r.duplicates + r.noId + r.skippedType + r.skipped;
      if (ign) {
        li.push('<li>Ignorados: <b>' + ign + '</b> (' + [
          r.duplicates ? r.duplicates + ' repetidos no arquivo' : '',
          r.noId ? r.noId + ' sem código do IMDb' : '',
          r.skippedType ? r.skippedType + ' de tipo não suportado' + (types ? ' — ' + types : '') : '',
          r.skipped ? r.skipped + ' inválidos' : ''
        ].filter(Boolean).join(', ') + ')</li>');
      }
      if (r.episodesMatched) {
        li.push('<li>Episódios avaliados somados às séries: <b>' + r.episodesMatched.toLocaleString('pt-BR') + '</b> em <b>' + r.episodesSeries + '</b> séries' +
          (r.seasonsLookup ? ' <span id="seasons-progress" class="muted">· buscando as temporadas no TMDB…</span>' : '') + '</li>');
      }
      var un = (r.episodesUnmatched || []).map(function (u) { return escapeHtml(u.title) + ' (' + u.count + ')'; }).join(', ');
      if (un) li.push('<li>Episódios de séries que não estão no catálogo: ' + un + '. Adicione a série (com o link do IMDb) e importe de novo.</li>');
      el.innerHTML = '<h3>Importação do IMDb concluída</h3><ul>' + li.join('') + '</ul>' +
        '<p>Agora o catálogo tem <b>' + n('movie') + ' filmes</b> e <b>' + n('series') + ' séries</b>.</p>' +
        '<button type="button" class="btn-secondary" id="import-close">Fechar</button>';
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  document.getElementById('import-result').addEventListener('click', function (e) {
    if (e.target.closest('#import-close')) this.classList.add('hidden');
  });

  // Acompanha a busca de temporadas (segundo plano no servidor) e atualiza a lista quando termina.
  function watchSeasons() {
    function setText(t) { var el = document.getElementById('seasons-progress'); if (el) el.textContent = t; }
    function tick() {
      api('GET', '/api/episodes/sync').then(function (st) {
        if (st.error) { setText('· temporadas: ' + st.error); return; }
        if (st.running) { setText('· buscando as temporadas no TMDB… ' + st.done + '/' + st.total); setTimeout(tick, 2000); return; }
        api('GET', '/api/entries').then(function (list) {
          entries = visible(list);
          render();
          setText(st.failed ? '· temporadas atualizadas; ' + st.failed + ' episódios falharam (importe de novo para tentar outra vez)' : '· temporadas atualizadas');
        });
      }).catch(function () {});
    }
    setTimeout(tick, 800);
  }

  var coversEnabled = false;
  document.getElementById('imdb-import-btn').addEventListener('click', function () {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var btn = document.getElementById('imdb-import-btn');
      var label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Importando…';
      api('POST', '/api/import/imdb', undefined, new Blob([f], { type: 'text/csv' })).then(function (r) {
        return api('GET', '/api/entries').then(function (list) {
          entries = visible(list);
          render();
          showImportResult(r, list);
          if (coversEnabled && r.created) syncCovers();
          if (r.seasonsLookup && r.episodesMatched) watchSeasons();
        });
      }).catch(function (err) {
        showImportResult({ error: err.message });
      }).then(function () {
        btn.disabled = false;
        btn.textContent = label;
      });
    });
    input.click();
  });
  api('GET', '/api/me').then(function (me) {
    shareBgVersion = me.shareBg || null;
    applyLogo(me.logo || null);
    if (state.activeTab === 'share') renderShare();
    coversEnabled = !!me.covers;
    if (me.covers) {
      document.getElementById('covers-btn').classList.remove('hidden');
      document.getElementById('tmdb-note').classList.remove('hidden');
    }
  }).catch(function () {});

  renderTabs();
  api('GET', '/api/entries').then(function (list) {
    entries = visible(list);
    render();
  }).catch(function (err) {
    var emptyEl = document.getElementById('empty-state');
    emptyEl.classList.remove('hidden');
    emptyEl.textContent = 'Não foi possível carregar seus registros: ' + err.message;
  });
})();
