(function () {
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
