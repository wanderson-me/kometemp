# Publicar o Meu Arquivo na nuvem

O app é um servidor Node.js (22.13 ou mais novo) com banco SQLite. Não tem dependências para instalar. O que ele precisa da hospedagem:

1. **Rodar Node 22+** (a imagem `Dockerfile` já resolve isso).
2. **Um disco/volume persistente** montado em `DATA_DIR` (o banco e as capas ficam lá). Sem volume, os dados somem a cada novo deploy.
3. **Uma única instância** (SQLite não é feito para vários servidores gravando juntos).
4. As variáveis de ambiente abaixo.

## Variáveis de ambiente

| Variável | Obrigatória | O que faz |
|---|---|---|
| `APP_PASSWORD` ou `APP_PASSWORD_HASH` | sim | Sua senha. O hash é mais seguro: `npm run hash-password -- "sua senha"` |
| `APP_USERNAME` | não (padrão `wanderson`) | Nome de usuário |
| `DATA_DIR` | sim na nuvem | Pasta do volume, ex.: `/data` |
| `TRUST_PROXY` | `1` na nuvem | Faz o app confiar no HTTPS/IP informados pelo proxy da hospedagem |
| `NODE_ENV` | `production` | Cookie de sessão só por HTTPS |
| `SESSION_SECRET` | não | Segredo da sessão. Se vazio, é gerado e guardado em `DATA_DIR` |
| `AUTO_SEED` | não (padrão `1`) | Na primeira execução, com banco vazio, importa `seed/entries.json` (seus 622 registros + 3 capas) |

## Opção 0 — Em casa, sem custo (Proxmox, mini PC, Raspberry, VPS próprio)

Num Debian/Ubuntu (por exemplo um container LXC no Proxmox, com 1 vCPU, 512 MB de RAM e 4 GB de disco), como root:

```bash
apt update && apt install -y curl     # imagens mínimas do Debian não trazem o curl
curl -fsSL https://raw.githubusercontent.com/wanderson-me/kometemp/main/deploy/install-linux.sh -o install.sh
bash install.sh
```

O script instala o Node 22, baixa o app, pergunta usuário e senha, cria o serviço `meu-arquivo` (sobe sozinho com a máquina) e mostra o endereço `http://IP:3000`. Os dados ficam em `/var/lib/meu-arquivo`. Para atualizar, rode `bash install.sh` de novo (ou, manualmente: `git -c safe.directory=/opt/meu-arquivo/app -C /opt/meu-arquivo/app pull && systemctl restart meu-arquivo`).

- Em rede local por HTTP, o login funciona normalmente. Para HTTPS e acesso de fora, use Tailscale (`tailscale serve --bg 3000`) ou um proxy como o Caddy. Em container LXC, o Tailscale precisa do `/dev/net/tun` liberado na configuração do container.
- Backup: inclua o container no backup do Proxmox e/ou use **Baixar backup** dentro do app.
- Comandos úteis: `systemctl status meu-arquivo`, `journalctl -u meu-arquivo -f`.

## Opção A — Fly.io (usa o `fly.toml` do repositório)

Pré-requisito: conta no Fly.io e a CLI `flyctl` instalada (https://fly.io/docs/flyctl/install/). Consulte o preço atual na página deles; um app pequeno com 1 volume costuma ficar baixo.

```bash
git clone https://github.com/wanderson-me/kometemp.git && cd kometemp
# edite o nome do app em fly.toml (precisa ser único no Fly)
fly launch --no-deploy --copy-config
fly volumes create meu_arquivo_data --size 1 --region gru
fly secrets set APP_PASSWORD="sua-senha-longa" APP_USERNAME="wanderson"
fly deploy
```

O endereço será `https://<nome-do-app>.fly.dev`. Na primeira subida o app importa o seed sozinho.

## Opção B — Qualquer servidor com Docker (VPS, Railway, Render etc.)

```bash
docker build -t meu-arquivo .
docker run -d --name meu-arquivo --restart unless-stopped \
  -p 8080:8080 -v meu_arquivo_data:/data \
  -e APP_USERNAME=wanderson -e APP_PASSWORD='sua-senha-longa' \
  -e TRUST_PROXY=1 \
  meu-arquivo
```

Coloque um proxy com HTTPS na frente (Caddy, Nginx, ou o próprio proxy da plataforma). Em serviços como Railway e Render, crie o serviço a partir do repositório (ele usa o `Dockerfile`), **adicione um volume/disco persistente com ponto de montagem `/data`** e cadastre as variáveis da tabela. Disco persistente costuma exigir plano pago em alguns serviços; confira antes.

## Rodar no seu computador

```bash
cp .env.example .env     # edite a senha
npm start                # http://localhost:3000
```

Precisa de Node 22.13+. Para testar: `npm test`.

## Capas automáticas (TMDB)

O app pode buscar o pôster de cada filme/série pelo código do IMDb que você cadastrou. Precisa de uma chave gratuita do TMDB:

1. Crie uma conta em https://www.themoviedb.org e vá em **Configurações → API** (https://www.themoviedb.org/settings/api). Peça a chave para uso pessoal/não comercial.
2. Copie a **Chave da API** (32 caracteres) ou o **Token de Acesso de Leitura** — qualquer um funciona.
3. No servidor: `echo 'TMDB_API_KEY=sua-chave' >> /etc/meu-arquivo.env && systemctl restart meu-arquivo`.
4. No app, clique em **Buscar capas** na barra lateral. Ele preenche as capas que faltam (leva alguns minutos para ~600 itens). Daí em diante, todo registro novo com link do IMDb ganha a capa sozinho.

O servidor precisa alcançar `api.themoviedb.org` e `image.tmdb.org`. Capas que você enviou manualmente nunca são substituídas. Os dados de imagem vêm do TMDB; o app mostra o aviso de atribuição exigido por eles.

## Backup e restauração

- Dentro do app, **Baixar backup** (barra lateral) gera um JSON com todos os registros **e as capas embutidas**.
- Para restaurar em outro servidor: `POST /api/import` com esse JSON (logado), ou `DATA_DIR=./data node scripts/import.js arquivo.json` no servidor.
- O banco também pode ser copiado direto: `meu-arquivo.db` (+ `-wal`/`-shm` se existirem) e a pasta `covers/` dentro de `DATA_DIR`.

## Segurança em resumo

- Senha guardada só como hash scrypt; cookie de sessão assinado, `HttpOnly`, `SameSite=Lax` e `Secure` em produção.
- 5 tentativas erradas de login por IP bloqueiam por 15 minutos.
- Requisições que alteram dados vindas de outro site são recusadas.
- Capas só são aceitas se forem de fato imagem (JPG/PNG/WEBP/GIF) e só são servidas a quem está logado.
- Trocar `SESSION_SECRET` (ou apagar `.session-secret` em `DATA_DIR`) derruba todas as sessões abertas.

## Observações

- A imagem do resumo mensal (800×800) é desenhada no próprio navegador, sem bibliotecas externas. As fontes vêm do Google Fonts (sem elas, usa fontes de reserva). O fundo opcional da imagem fica em `DATA_DIR/share-bg.*` (fora do Git) e é enviado pelo botão **Escolher fundo** do resumo.
- O estado do **artefato do Claude** deixa de ser a fonte de verdade: depois que você começa a usar o servidor, os novos registros ficam no banco dele.
