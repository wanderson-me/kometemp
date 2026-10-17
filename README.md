# Meu Arquivo

Catálogo pessoal de jogos de console, filmes e séries, com banco de dados e login.

- **Back-end:** Node.js puro + SQLite (`node:sqlite`, embutido no Node 22.13+). Sem dependências npm.
- **Acesso:** usuário único, senha com scrypt, sessão por cookie assinado.
- **Front-end:** HTML/CSS/JS sem build, em `public/`.
- **Dados iniciais:** `seed/entries.json` (622 registros) + `seed/covers/` (3 capas), importados na primeira execução.

```bash
cp .env.example .env   # defina APP_PASSWORD
npm start              # http://localhost:3000
npm test
```

Publicação na nuvem (Docker / Fly.io), variáveis de ambiente e backup: veja [DEPLOY.md](DEPLOY.md).

## Estrutura

```
server.js        servidor HTTP, rotas da API, cabeçalhos de segurança
lib/db.js        SQLite: registros, capas, exportar/importar
lib/imdb.js      leitura do CSV do IMDb
lib/tmdb.js      busca de pôsteres no TMDB
lib/auth.js      senha (scrypt), sessão assinada, limite de tentativas
public/          index.html, login.html, app.js, styles.css
seed/            registros e capas iniciais
scripts/         hash-password.js, import.js
test/            testes automatizados (node --test)
legacy/          versão anterior, publicada como Claude Artifact
```

## API (exige login)

| Método | Rota | |
|---|---|---|
| POST | `/api/login`, `/api/logout` | |
| GET / POST | `/api/entries` | listar / criar |
| GET / PUT / DELETE | `/api/entries/:id` | |
| PUT / DELETE | `/api/entries/:id/cover` | enviar (corpo = imagem) / remover capa |
| POST / GET | `/api/covers/sync` | iniciar / consultar a busca de capas no TMDB (precisa de `TMDB_API_KEY`) |
| GET | `/api/export?covers=1` | backup em JSON |
| POST | `/api/import` | restaurar backup |
| POST | `/api/import/imdb` | importar CSV exportado do IMDb (corpo = texto do CSV) |
