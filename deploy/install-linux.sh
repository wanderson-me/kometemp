#!/usr/bin/env bash
# Instala o Meu Arquivo como serviço (systemd) em Debian/Ubuntu — ex.: container LXC no Proxmox.
# Rode como root:  bash install-linux.sh
# Para atualizar depois: rode de novo o mesmo comando (mantém senha e dados).
set -euo pipefail

REPO="${REPO:-https://github.com/wanderson-me/kometemp.git}"
APP_DIR=/opt/meu-arquivo/app
DATA_DIR=/var/lib/meu-arquivo
ENV_FILE=/etc/meu-arquivo.env
PORT="${PORT:-3000}"

[ "$(id -u)" -eq 0 ] || { echo "Rode como root."; exit 1; }

echo "==> Dependências básicas"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates >/dev/null

need_node=1
if command -v node >/dev/null 2>&1; then
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' && need_node=0
fi
if [ "$need_node" -eq 1 ]; then
  echo "==> Instalando Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "Node $(node -v)"

id meuarq >/dev/null 2>&1 || useradd -r -m -d /opt/meu-arquivo -s /usr/sbin/nologin meuarq

echo "==> Código"
if [ -d "$APP_DIR/.git" ]; then
  git -c safe.directory="$APP_DIR" -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO" "$APP_DIR"
fi
mkdir -p "$DATA_DIR"
chown -R meuarq: "$DATA_DIR" /opt/meu-arquivo

if [ ! -f "$ENV_FILE" ]; then
  echo "==> Configuração"
  USER_NAME="${APP_USERNAME:-}"
  [ -n "$USER_NAME" ] || read -r -p "Usuário [wanderson]: " USER_NAME
  USER_NAME="${USER_NAME:-wanderson}"
  PASS="${APP_PASSWORD:-}"
  while [ ${#PASS} -lt 8 ]; do
    read -r -s -p "Senha (mínimo 8 caracteres): " PASS; echo
  done
  HASH=$(node "$APP_DIR/scripts/hash-password.js" "$PASS")
  umask 077
  cat > "$ENV_FILE" <<CFG
APP_USERNAME=$USER_NAME
APP_PASSWORD_HASH=$HASH
DATA_DIR=$DATA_DIR
PORT=$PORT
TRUST_PROXY=1
CFG
  chown root:meuarq "$ENV_FILE"; chmod 640 "$ENV_FILE"
fi

echo "==> Serviço systemd"
cat > /etc/systemd/system/meu-arquivo.service <<UNIT
[Unit]
Description=Meu Arquivo
After=network.target

[Service]
User=meuarq
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) --disable-warning=ExperimentalWarning server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable meu-arquivo >/dev/null 2>&1
systemctl restart meu-arquivo
sleep 2
systemctl --no-pager --lines=5 status meu-arquivo || true

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "Pronto. Abra: http://${IP:-IP-DO-CONTAINER}:$PORT"
