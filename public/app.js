(function () {
  var STATUS = {
    game: ['Jogando', 'Completo', 'Abandonado'],
    series: ['Assistindo', 'Completa']
  };
  var LABELS = {
    game: { name: 'jogo', plural: 'jogos', extraLabel: 'Plataforma / console' },
    movie: { name: 'filme', plural: 'filmes', extraLabel: 'Ano de lançamento' },
    series: { name: 'série', plural: 'séries', extraLabel: 'Temporadas assistidas' }
  };

  var entries = [];

  var state = {
    activeTab: 'game',
    search: '',
    sort: 'recent',
    editingId: null,
    formOpen: false,
    genreFilter: null,
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

  function starsMarkup(rating, interactiveId) {
    var out = '';
    for (var i = 1; i <= 5; i++) {
      out += '<span class="' + (i <= rating ? '' : 'empty-star') + '">' + (i <= rating ? '★' : '☆') + '</span>';
    }
    return out;
  }

  function renderTabs() {
    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.type === state.activeTab);
    });
    ['game', 'movie', 'series'].forEach(function (t) {
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
    var avg = rated.length ? (rated.reduce(function (s, e) { return s + e.rating; }, 0) / rated.length).toFixed(1) : '—';
    var extra = '';
    if (state.activeTab === 'game') {
      var completos = list.filter(function (e) { return e.status === 'Completo'; }).length;
      extra = '<div><b>' + completos + '</b>completados</div>';
    } else if (state.activeTab === 'movie') {
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
    if (e.type === 'game') {
      var bits = [];
      if (e.platform) bits.push(escapeHtml(e.platform));
      if (e.date) bits.push('concluído em ' + formatDate(e.date));
      return bits.join(' · ');
    }
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
      series: ['#b9842a', '#6f5215'],
      game: ['#4f7a52', '#2d472f']
    };
    var base = palettes[e.type] || palettes.movie;
    var angle = (hashStr(e.title) % 140) + 20;
    return 'background:linear-gradient(' + angle + 'deg,' + base[0] + ',' + base[1] + ')';
  }

  function renderList() {
    var list = entries.filter(function (e) { return e.type === state.activeTab; });
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

    var listEl = document.getElementById('list');
    var emptyEl = document.getElementById('empty-state');
    if (!list.length) {
      listEl.innerHTML = '';
      emptyEl.classList.remove('hidden');
      var total = entries.filter(function (e) { return e.type === state.activeTab; }).length;
      emptyEl.textContent = total === 0
        ? 'Nada por aqui ainda. Toque em "+ Adicionar" para registrar seu primeiro ' + LABELS[state.activeTab].name + '.'
        : 'Nenhum resultado para essa busca.';
      return;
    }
    emptyEl.classList.add('hidden');

    listEl.innerHTML = list.map(function (e) {
      var hasCover = !!e.coverUrl;
      var posterInner = hasCover
        ? '<div class="poster-img" style="background-image:url(&quot;' + escapeHtml(e.coverUrl) + '&quot;)"></div>'
        : '<div class="poster-img poster-placeholder" style="' + posterPlaceholder(e) + '"><span class="poster-initial">' + escapeHtml((e.title || '?').trim().charAt(0).toUpperCase()) + '</span></div>';
      var ratingBadge = e.rating ? '<span class="poster-rating">★ ' + e.rating + '</span>' : '';
      var statusBadge = e.status ? '<span class="poster-status">' + escapeHtml(e.status) + '</span>' : '';
      var genreHtml = '';
      if (e.genres && e.genres.length) {
        var shown = e.genres.slice(0, 2).map(function (g) { return '<span class="genre-tag">' + escapeHtml(g) + '</span>'; }).join('');
        var more = e.genres.length > 2 ? '<span class="genre-tag">+' + (e.genres.length - 2) + '</span>' : '';
        genreHtml = '<div class="genre-tags">' + shown + more + '</div>';
      }
      return '' +
        '<article class="card type-' + e.type + '" data-id="' + e.id + '">' +
          '<div class="poster">' +
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
      var r = parseInt(e.rating, 10) || 0;
      if (r > 0 && (!topMovie || r > (parseInt(topMovie.rating, 10) || 0))) {
        topMovie = e;
      }
    });
    return { totalCount: totalCount, totalMinutes: totalMinutes, monthLabel: monthLabel, monthMovies: monthMovies, monthMinutes: monthMinutes, topMovie: topMovie };
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
            '<div class="recap-spotlight-stars">' + starsMarkup(tm.rating || 0) + '</div>' +
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
        '<button type="button" class="btn-add" id="recap-image-btn">Baixar imagem</button>' +
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
      lines.push('⭐ Filme do mês: ' + d.topMovie.title + ' (' + (parseInt(d.topMovie.rating, 10) || 0) + '/5)');
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

  async function downloadRecapImage() {
    if (typeof html2canvas === 'undefined') {
      showToast('Não foi possível gerar a imagem agora.');
      return;
    }
    var card = document.getElementById('recap-card');
    if (!card) return;
    var btn = document.getElementById('recap-image-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Gerando…'; }
    try {
      var canvas = await html2canvas(card, { backgroundColor: '#241f19', scale: 2 });
      var SIZE = 800;
      var out = document.createElement('canvas');
      out.width = SIZE;
      out.height = SIZE;
      var octx = out.getContext('2d');
      octx.fillStyle = '#241f19';
      octx.fillRect(0, 0, SIZE, SIZE);
      var fit = Math.min(SIZE / canvas.width, SIZE / canvas.height);
      var fw = canvas.width * fit;
      var fh = canvas.height * fit;
      octx.drawImage(canvas, (SIZE - fw) / 2, (SIZE - fh) / 2, fw, fh);
      out.toBlob(function (blob) {
        if (btn) { btn.disabled = false; btn.textContent = 'Baixar imagem'; }
        if (!blob) { showToast('Não foi possível gerar a imagem.'); return; }
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'meu-registro-' + new Date().toISOString().slice(0, 7) + '.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        showToast('Imagem salva!');
      }, 'image/png');
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Baixar imagem'; }
      showToast('Não foi possível gerar a imagem.');
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
    var rating = existing.rating || 0;
    var starsHtml = '';
    for (var i = 1; i <= 5; i++) {
      starsHtml += '<button type="button" data-val="' + i + '" class="' + (i <= rating ? 'filled' : '') + '">★</button>';
    }
    var extraField = '';
    if (type === 'game') {
      extraField =
        '<div class="form-field"><label>Plataforma / console</label>' +
        '<input type="text" name="platform" value="' + escapeHtml(existing.platform || '') + '" placeholder="Ex: PS5, Switch, PC"></div>' +
        '<div class="form-field"><label>Status</label><select name="status">' +
        STATUS.game.map(function (s) { return '<option ' + (existing.status === s ? 'selected' : '') + '>' + s + '</option>'; }).join('') +
        '</select></div>';
    } else if (type === 'movie') {
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
        '<div class="form-field"><label>' + (type === 'movie' ? 'Assistido em' : (type === 'game' ? 'Concluído em' : 'Atualizado em')) + '</label>' +
        '<input type="date" name="date" value="' + escapeHtml(existing.date || '') + '"></div>' +
        '<div class="form-field"><label>Nota</label><div class="star-input" id="star-input">' + starsHtml + '</div>' +
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
      '<h2>' + (existing ? 'Editar ' : 'Adicionar ') + LABELS[type].name + '</h2>' +
      '<form id="entry-form">' +
        fieldForType(type, existing) +
        '<div class="form-actions">' +
          '<button type="button" class="btn-secondary" id="cancel-form">Cancelar</button>' +
          '<button type="submit" class="btn-primary">Salvar</button>' +
        '</div>' +
      '</form>';
    panel.classList.remove('hidden');
    panel.dataset.type = type;

    panel.querySelectorAll('.star-input button').forEach(function (b) {
      b.addEventListener('click', function () {
        var val = parseInt(b.dataset.val, 10);
        var hidden = panel.querySelector('input[name="rating"]');
        var current = parseInt(hidden.value, 10) || 0;
        var newVal = (current === val) ? val - 1 : val;
        hidden.value = newVal;
        panel.querySelectorAll('.star-input button').forEach(function (bb) {
          bb.classList.toggle('filled', parseInt(bb.dataset.val, 10) <= newVal);
        });
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
    document.getElementById('entry-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      saveForm(type);
    });

    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeForm() {
    state.formOpen = false;
    state.editingId = null;
    var panel = document.getElementById('form-panel');
    panel.classList.add('hidden');
    panel.innerHTML = '';
  }

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
    if (type === 'game') {
      payload.platform = (fd.get('platform') || '').toString().trim();
      payload.status = fd.get('status');
    } else if (type === 'movie') {
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
      showToast('Não foi possível salvar: ' + err.message);
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
      document.getElementById('search-input').value = '';
      closeForm();
      render();
    });
  });

  document.getElementById('movie-recap').addEventListener('click', function (e) {
    if (e.target.closest('#recap-copy-btn')) { copyRecapText(); return; }
    if (e.target.closest('#recap-image-btn')) { downloadRecapImage(); return; }
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

  document.getElementById('sort-select').addEventListener('change', function (e) {
    state.sort = e.target.value;
    renderList();
  });

  document.getElementById('add-btn').addEventListener('click', function () {
    if (state.formOpen && !state.editingId) { closeForm(); return; }
    openForm(null);
  });

  document.getElementById('list').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var card = e.target.closest('.card');
    var id = card.dataset.id;
    var entry = entries.find(function (x) { return x.id === id; });
    if (!entry) return;
    if (btn.dataset.action === 'edit') {
      openForm(entry);
    } else if (btn.dataset.action === 'delete') {
      if (confirm('Excluir "' + entry.title + '"?')) deleteEntry(id);
    }
  });

  document.getElementById('logout-btn').addEventListener('click', function () {
    fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).finally(function () { location.replace('/login'); });
  });

  renderTabs();
  api('GET', '/api/entries').then(function (list) {
    entries = list;
    render();
  }).catch(function (err) {
    var emptyEl = document.getElementById('empty-state');
    emptyEl.classList.remove('hidden');
    emptyEl.textContent = 'Não foi possível carregar seus registros: ' + err.message;
  });
})();
