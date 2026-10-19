# WAndCine

Catálogo pessoal de filmes e séries, com banco de dados e login.

A logo não fica no repositório: depois de entrar, use **Trocar logo** na barra lateral. O arquivo é guardado na pasta de dados do servidor e aparece também na tela de login.

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
| POST | `/api/import/imdb` | importar CSV exportado do IMDb (corpo = texto do CSV). Notas de episódios soltos somam "episódios assistidos" e "tempo assistido" da série |
| GET/POST | `/api/episodes/sync` | estado / início da busca de temporadas dos episódios no TMDB (preenche "3 de 8" e o status; roda sozinha após importar) |
