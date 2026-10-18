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
      var episodesThisMonth = list.reduce(function (s, e) { return s + (isSameMonth(e.date) ? (parseInt(e.episodes, 10) || 0) : 0); }, 0);
      extra += '<div><b>' + episodesThisMonth + '</b>episódios este mês</div>';
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
    var totalCount = movies.length;
    var totalMinutes = movies.reduce(function (s, e) { return s + (parseInt(e.duration, 10) || 0); }, 0);
    var now = new Date();
    var monthLabel = MONTH_NAMES[now.getMonth()] + ' de ' + now.getFullYear();
    var monthMovies = movies.filter(function (e) { return isSameMonth(e.date); });
    monthMovies.sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
    var monthMinutes = monthMovies.reduce(function (s, e) { return s + (parseInt(e.duration, 10) || 0); }, 0);
    var topMovie = null;
    monthMovies.forEach(function (e) {
      var r = num(e.rating);
      if (r > 0 && (!topMovie || r > num(topMovie.rating))) {
        topMovie = e;
      }
    });
    return { totalCount: totalCount, totalMinutes: totalMinutes, monthLabel: monthLabel, monthMovies: monthMovies, monthMinutes: monthMinutes, topMovie: topMovie };
  }

  function canShareFiles() {
    try {
      if (!(window.matchMedia && matchMedia('(pointer: coarse)').matches)) return false;
      return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'a.png', { type: 'image/png' })] }));
    } catch (err) { return false; }
  }

  function renderMovieRecap() {
    var el = document.getElementById('movie-recap');
    if (state.activeTab !== 'movie') {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    var d = getRecapData();
    var listHtml = d.monthMovies.length ? d.monthMovies.map(function (e) {
      var genresStr = (e.genres && e.genres.length) ? e.genres.join(', ') : '';
      return '<div class="recap-item">' +
        '<span class="recap-item-title">' + escapeHtml(e.title) + '</span>' +
        (genresStr ? '<span class="recap-item-genre">' + escapeHtml(genresStr) + '</span>' : '') +
      '</div>';
    }).join('') : '<div class="recap-empty">Nenhum filme registrado este mês ainda.</div>';

    var spotlightHtml = '';
    if (d.topMovie) {
      var tm = d.topMovie;
      var tmGenres = (tm.genres && tm.genres.length) ? tm.genres.join(', ') : '';
      var tmCover = tm.coverUrl ? '<div class="recap-spotlight-cover" style="background-image:url(&quot;' + escapeHtml(tm.coverUrl) + '&quot;)"></div>' : '';
      spotlightHtml =
        '<div class="recap-spotlight">' +
          tmCover +
          '<div class="recap-spotlight-body">' +
            '<div class="recap-spotlight-label">⭐ Filme do mês</div>' +
            '<div class="recap-spotlight-title">' + escapeHtml(tm.title) + '</div>' +
            '<div class="recap-spotlight-stars">★ ' + formatRating(tm.rating) + '<small>/10</small></div>' +
            (tmGenres ? '<div class="recap-spotlight-genre">' + escapeHtml(tmGenres) + '</div>' : '') +
          '</div>' +
        '</div>';
    }

    el.classList.remove('hidden');
    el.innerHTML =
      '<div class="recap-card" id="recap-card">' +
        '<div class="recap-header"><span class="recap-emoji">🎬</span><div><h2>Meu registro</h2><span class="recap-month">' + escapeHtml(d.monthLabel) + '</span></div></div>' +
        '<div class="recap-totals">' +
          '<div class="recap-stat"><b>' + d.totalCount + '</b><span>filmes assistidos</span></div>' +
          '<div class="recap-stat"><b>' + formatDuration(d.totalMinutes) + '</b><span>tempo total consumido</span></div>' +
        '</div>' +
        spotlightHtml +
        '<div class="recap-month-highlight">' +
          '<div class="recap-month-head"><h3>Este mês</h3><span>' + d.monthMovies.length + (d.monthMovies.length === 1 ? ' filme' : ' filmes') + (d.monthMinutes ? ' · ' + formatDuration(d.monthMinutes) : '') + '</span></div>' +
          '<div class="recap-list">' + listHtml + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="recap-actions">' +
        '<button type="button" class="btn-secondary" id="recap-copy-btn">Copiar texto</button>' +
        '<div class="seg" role="group" aria-label="Formato da imagem">' +
          Object.keys(SHARE_FORMATS).map(function (k) {
            return '<button type="button" class="seg-btn' + (k === shareFormat ? ' on' : '') + '" data-fmt="' + k + '" aria-pressed="' + (k === shareFormat) + '">' + SHARE_FORMATS[k].label + '</button>';
          }).join('') +
        '</div>' +
        '<button type="button" class="btn-add" id="recap-image-btn">Baixar imagem</button>' +
        (canShareFiles() ? '<button type="button" class="btn-secondary" id="recap-share-btn">Compartilhar</button>' : '') +
        '<button type="button" class="btn-secondary" id="recap-bg-btn">' + (shareBgVersion ? 'Trocar fundo' : 'Escolher fundo') + '</button>' +
        (shareBgVersion ? '<button type="button" class="btn-secondary" id="recap-bg-remove">Remover fundo</button>' : '') +
      '</div>';
  }

  function buildRecapText() {
    var d = getRecapData();
    var lines = [];
    lines.push('🎬 Meu registro — ' + d.monthLabel);
    lines.push('');
    lines.push(d.totalCount + ' filmes assistidos no total (' + formatDuration(d.totalMinutes) + ')');
    if (d.topMovie) {
      lines.push('');
      lines.push('⭐ Filme do mês: ' + d.topMovie.title + ' (' + formatRating(d.topMovie.rating) + '/10)');
    }
    lines.push('');
    lines.push('Este mês (' + d.monthMovies.length + '):');
    if (!d.monthMovies.length) {
      lines.push('Nenhum filme registrado este mês ainda.');
    } else {
      d.monthMovies.forEach(function (e) {
        var genresStr = (e.genres && e.genres.length) ? ' — ' + e.genres.join(', ') : '';
        lines.push('• ' + e.title + genresStr);
      });
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
    square: { H: 800, label: '800×800', maxRows: 3, heroH: 210, maxTile: 133 },
    portrait: { H: 1000, label: '800×1000', maxRows: 4, heroH: 270, maxTile: 190 }
  };
  var shareFormat = 'square';
  try { var savedFmt = localStorage.getItem('wandcine.shareFormat'); if (SHARE_FORMATS[savedFmt]) shareFormat = savedFmt; } catch (_) { /* sem armazenamento */ }
  var SHARE = { W: 800, M: 48, BG: '#1c1914', GOLD: '#f6dfab', STAR: '#e8c267', DISPLAY: '"Bebas Neue", "Arial Narrow", Impact, sans-serif', BODY: '"Work Sans", -apple-system, "Segoe UI", sans-serif' };

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

  async function buildShareImage() {
    var d = getRecapData();
    var FMT = SHARE_FORMATS[shareFormat] || SHARE_FORMATS.square;
    var W = SHARE.W, H = FMT.H, M = SHARE.M, CW = W - 2 * M;
    try {
      await Promise.all([
        document.fonts.load('64px "Bebas Neue"'),
        document.fonts.load('400 16px "Work Sans"'),
        document.fonts.load('600 18px "Work Sans"')
      ]);
    } catch (err) { /* usa as fontes de reserva */ }

    var n = d.monthMovies.length;
    var top = d.topMovie;
    var hasHero = !!top;

    // Layout da faixa de pôsteres: o maior tamanho em que todos cabem (até 3 linhas)
    var HERO_H = FMT.heroH;
    var headBottom = M + 78 + 24 + 74 + 28;           // fim do cabeçalho + números
    var regionTop = headBottom + (hasHero ? HERO_H + 28 + 26 : 0);
    var footerY = H - M + 4;
    var regionBottom = footerY - 34;
    var gridTop = regionTop + 36;
    var availH = regionBottom - gridTop;
    var tileW = 48, perRow = 1, rows = 1, overflow = 0;
    var shown = d.monthMovies;
    var fitted = false;
    for (var tw0 = FMT.maxTile; tw0 >= 48 && !fitted; tw0--) {
      var th0 = Math.round(tw0 * 1.5);
      var r0 = Math.min(FMT.maxRows, Math.floor((availH + 8) / (th0 + 8)));
      var c0 = Math.floor((CW + 8) / (tw0 + 8));
      if (r0 >= 1 && c0 * r0 >= n) {
        tileW = tw0; perRow = c0; rows = Math.max(1, Math.ceil(n / c0)); fitted = true;
      }
    }
    if (!fitted) {
      tileW = 48;
      perRow = Math.floor((CW + 8) / (tileW + 8));
      rows = Math.max(1, Math.min(FMT.maxRows, Math.floor((availH + 8) / (Math.round(tileW * 1.5) + 8))));
      var cap = perRow * rows;
      shown = d.monthMovies.slice(0, cap - 1);
      overflow = n - shown.length;
    }
    var tileH = Math.round(tileW * 1.5);

    var imgs = await Promise.all([loadImage(top && top.coverUrl), loadImage(shareBgVersion ? '/share-bg?v=' + shareBgVersion : null)]
      .concat(shown.map(function (e) { return loadImage(e.coverUrl); })));
    var topImg = imgs[0];
    var bgImg = imgs[1];
    imgs.splice(1, 1); // deixa imgs[i + 1] = pôster de shown[i]

    var S = 2;
    var big = document.createElement('canvas');
    big.width = W * S;
    big.height = H * S;
    var ctx = big.getContext('2d');
    ctx.scale(S, S);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    // Fundo
    ctx.fillStyle = SHARE.BG;
    ctx.fillRect(0, 0, W, H);
    var bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#241f19');
    bg.addColorStop(0.55, '#2d251d');
    bg.addColorStop(1, '#6b2f19');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    if (bgImg) {
      // Ilustração do usuário ao fundo, com opacidade baixa, e um véu escuro para o texto ficar legível.
      ctx.save();
      ctx.globalAlpha = 0.34;
      var bs = Math.max(W / bgImg.width, H / bgImg.height);
      var bw = bgImg.width * bs, bh = bgImg.height * bs;
      ctx.drawImage(bgImg, (W - bw) / 2, (H - bh) / 2, bw, bh);
      ctx.restore();
      var veil = ctx.createLinearGradient(0, 0, 0, H);
      veil.addColorStop(0, 'rgba(20,16,12,0.62)');
      veil.addColorStop(0.45, 'rgba(20,16,12,0.30)');
      veil.addColorStop(1, 'rgba(20,16,12,0.72)');
      ctx.fillStyle = veil;
      ctx.fillRect(0, 0, W, H);
    }

    // Título: apenas mês e ano
    var monthTitle = d.monthLabel.charAt(0).toUpperCase() + d.monthLabel.slice(1);
    ctx.fillStyle = SHARE.GOLD;
    var titleSize = 78;
    ctx.font = titleSize + 'px ' + SHARE.DISPLAY;
    while (titleSize > 36 && ctx.measureText(monthTitle).width > CW) {
      titleSize -= 2;
      ctx.font = titleSize + 'px ' + SHARE.DISPLAY;
    }
    ctx.fillText(monthTitle, M, M + 56);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(M, M + 78, CW, 1);

    // Números do mês
    var statsY = M + 78 + 24;
    var colW = CW / 3;
    var monthName = MONTH_NAMES[new Date().getMonth()];
    var stats = [
      { v: String(n), l: (n === 1 ? 'filme em ' : 'filmes em ') + monthName },
      { v: d.monthMinutes ? formatDuration(d.monthMinutes) : '—', l: 'assistidos no mês' }
    ];
    stats.forEach(function (st, i) {
      var x = M + i * colW;
      ctx.fillStyle = '#ffffff';
      var vs = 60;
      ctx.font = vs + 'px ' + SHARE.DISPLAY;
      while (vs > 30 && ctx.measureText(st.v).width > colW - 20) { vs -= 2; ctx.font = vs + 'px ' + SHARE.DISPLAY; }
      ctx.fillText(st.v, x, statsY + 50);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '400 16px ' + SHARE.BODY;
      ctx.fillText(ellipsize(ctx, st.l, colW - 12), x, statsY + 74);
    });

    var cursor = statsY + 74 + 28;

    // Filme do mês
    if (hasHero) {
      var hh = HERO_H, hw = Math.round(hh / 1.5);
      var boxH = hh + 28;
      ctx.save();
      roundRectPath(ctx, M, cursor, CW, boxH, 16);
      var hg = ctx.createLinearGradient(M, cursor, M + CW, cursor + boxH);
      hg.addColorStop(0, 'rgba(185,132,42,0.26)');
      hg.addColorStop(1, 'rgba(185,132,42,0.05)');
      ctx.fillStyle = hg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(185,132,42,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      drawPoster(ctx, top, topImg, M + 14, cursor + 14, hw, hh, 8);

      var tx = M + 14 + hw + 26;
      var tw = M + CW - 20 - tx;
      ctx.fillStyle = SHARE.STAR;
      ctx.font = '600 17px ' + SHARE.BODY;
      ctx.fillText('Filme do mês', tx, cursor + 14 + 22);

      var t = fitText(ctx, top.title, SHARE.DISPLAY, '', [64, 54, 46, 40], tw, 2);
      ctx.fillStyle = '#ffffff';
      ctx.font = t.size + 'px ' + SHARE.DISPLAY;
      var ty = cursor + 14 + 22 + 10 + t.size * 0.9;
      t.lines.forEach(function (ln, i) { ctx.fillText(ln, tx, ty + i * t.size * 0.98); });
      var after = ty + (t.lines.length - 1) * t.size * 0.98 + 26;

      drawStar(ctx, tx + 14, after, 14, SHARE.STAR);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 26px ' + SHARE.BODY;
      var scoreTxt = formatRating(top.rating);
      ctx.fillText(scoreTxt, tx + 36, after + 9);
      var scoreW = ctx.measureText(scoreTxt).width;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '400 18px ' + SHARE.BODY;
      ctx.fillText('/10', tx + 36 + scoreW + 3, after + 9);
      var gtxt = (top.genres && top.genres.length) ? top.genres.join(', ') : '';
      if (gtxt) {
        var gl = fitText(ctx, gtxt, SHARE.BODY, '400', [18, 16], tw, 2);
        ctx.fillStyle = 'rgba(255,255,255,0.68)';
        ctx.font = '400 ' + gl.size + 'px ' + SHARE.BODY;
        gl.lines.forEach(function (ln, i) { ctx.fillText(ln, tx, after + 34 + i * (gl.size + 5)); });
      }
      cursor += boxH + 26;
    }

    // Faixa de pôsteres do mês
    if (n === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '400 20px ' + SHARE.BODY;
      ctx.textAlign = 'center';
      ctx.fillText('Nenhum filme registrado este mês ainda.', W / 2, (regionTop + regionBottom) / 2);
      ctx.textAlign = 'left';
    } else {
      ctx.fillStyle = SHARE.GOLD;
      ctx.font = '30px ' + SHARE.DISPLAY;
      ctx.fillText('Este mês', M, regionTop + 22);
      var gridH = rows * tileH + (rows - 1) * 8;
      var gx = M;
      var gy = gridTop + Math.max(0, Math.floor((availH - gridH) / 2));
      var total = shown.length + (overflow ? 1 : 0);
      for (var q = 0; q < total; q++) {
        var col = q % perRow, row = Math.floor(q / perRow);
        var px = gx + col * (tileW + 8), py = gy + row * (tileH + 8);
        if (q < shown.length) {
          drawPoster(ctx, shown[q], imgs[q + 1], px, py, tileW, tileH, 6);
        } else {
          ctx.save();
          roundRectPath(ctx, px, py, tileW, tileH, 6);
          ctx.fillStyle = 'rgba(255,255,255,0.1)';
          ctx.fill();
          ctx.restore();
          ctx.fillStyle = '#ffffff';
          ctx.font = Math.round(tileH * 0.34) + 'px ' + SHARE.DISPLAY;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('+' + overflow, px + tileW / 2, py + tileH / 2);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
        }
      }
    }

    // Rodapé: totais gerais
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(M, footerY - 22, CW, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.font = '400 16px ' + SHARE.BODY;
    var lbl = 'Total de filmes: ';
    ctx.fillText(lbl, M, footerY);
    var lblW = ctx.measureText(lbl).width;
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 16px ' + SHARE.BODY;
    ctx.fillText(String(d.totalCount), M + lblW, footerY);
    if (d.totalMinutes) {
      var tv = formatDuration(d.totalMinutes);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 16px ' + SHARE.BODY;
      ctx.fillText(tv, W - M, footerY);
      var tvW = ctx.measureText(tv).width;
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.font = '400 16px ' + SHARE.BODY;
      ctx.fillText('Tempo total: ', W - M - tvW, footerY);
      ctx.textAlign = 'left';
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
        renderMovieRecap();
        showToast('Fundo atualizado. A próxima imagem já usa ele.');
      }).catch(function (err) { showToast('Não foi possível enviar o fundo: ' + err.message); });
    });
    input.click();
  }

  // ---- Logo ----
  function applyLogo(version) {
    var on = !!version;
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
      renderMovieRecap();
      showToast('Fundo removido.');
    }).catch(function (err) { showToast(err.message); });
  }

  async function shareRecapImage() {
    try {
      var blob = await buildShareImage();
      var file = new File([blob], recapFileName(), { type: 'image/png' });
      await navigator.share({ files: [file], title: 'Meu registro' });
    } catch (err) {
      if (!err || err.name !== 'AbortError') showToast('Não foi possível compartilhar.');
    }
  }

  function render() {
    renderTabs();
    renderStats();
    renderMovieRecap();
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

  document.getElementById('movie-recap').addEventListener('click', function (e) {
    var fmtBtn = e.target.closest('[data-fmt]');
    if (fmtBtn && SHARE_FORMATS[fmtBtn.dataset.fmt]) {
      shareFormat = fmtBtn.dataset.fmt;
      try { localStorage.setItem('wandcine.shareFormat', shareFormat); } catch (_) { /* sem armazenamento */ }
      renderMovieRecap();
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
      el.innerHTML = '<h3>Importação do IMDb concluída</h3><ul>' + li.join('') + '</ul>' +
        '<p>Agora o catálogo tem <b>' + n('movie') + ' filmes</b> e <b>' + n('series') + ' séries</b>.</p>' +
        '<button type="button" class="btn-secondary" id="import-close">Fechar</button>';
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  document.getElementById('import-result').addEventListener('click', function (e) {
    if (e.target.closest('#import-close')) this.classList.add('hidden');
  });

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
    renderMovieRecap();
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
