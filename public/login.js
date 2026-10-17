(function () {
  // Logo personalizada (se houver): troca a marca padrão e o ícone da aba.
  var probe = new Image();
  probe.onload = function () {
    document.getElementById('login-logo-img').src = '/logo';
    document.getElementById('login-logo').classList.remove('hidden');
    document.getElementById('login-brand-default').classList.add('hidden');
    var ic = document.querySelector('link[rel="icon"]');
    if (ic) { ic.type = 'image/png'; ic.href = '/logo'; }
  };
  probe.src = '/logo';
  var form = document.getElementById('login-form');
  var err = document.getElementById('login-error');
  var btn = document.getElementById('login-btn');
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    err.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Entrando…';
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value
      })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, data: d }; });
    }).then(function (res) {
      if (res.ok) { location.replace('/'); return; }
      err.textContent = res.data.error || 'Não foi possível entrar.';
      err.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Entrar';
      document.getElementById('password').select();
    }).catch(function () {
      err.textContent = 'Sem conexão com o servidor. Tente de novo.';
      err.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Entrar';
    });
  });
})();
