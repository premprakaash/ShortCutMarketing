#!/usr/bin/env bash
# One-time server setup for ShortCut Marketing on Ubuntu (run as a sudo user, not root).
#
#   curl -fsSL https://raw.githubusercontent.com/premprakaash/ShortCutMarketing/main/scripts/server-setup.sh -o setup.sh
#   bash setup.sh ads.shortcutvid.in
#
# Installs Node 22, Postgres, Nginx, Certbot and pm2; creates the database,
# the folder layout used by deploy.sh, an Nginx site and an HTTPS certificate.
set -euo pipefail

DOMAIN="${1:?Usage: bash server-setup.sh <domain>}"
APP_DIR="${APP_DIR:-/var/www/scm}"
REPO_URL="${REPO_URL:-https://github.com/premprakaash/ShortCutMarketing.git}"
DB_NAME="${DB_NAME:-scm}"
DB_USER="${DB_USER:-scm}"
PORT="${PORT:-3000}"

echo "==> Installing packages"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
fi
sudo apt-get install -y nodejs postgresql nginx certbot python3-certbot-nginx git curl
command -v pm2 >/dev/null || sudo npm i -g pm2

echo "==> Database"
DB_PASS="$(openssl rand -hex 16)"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
  NEW_DB=1
else
  echo "Database user $DB_USER already exists — keeping the existing password."
  NEW_DB=0
fi

echo "==> Folders"
sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER":"$USER" "$APP_DIR"
mkdir -p "$APP_DIR/shared" "$APP_DIR/releases"
[ -d "$APP_DIR/repo/.git" ] || git clone --depth 50 "$REPO_URL" "$APP_DIR/repo"

ENV_FILE="$APP_DIR/shared/.env.local"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
APP_URL=https://$DOMAIN
TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)
DATABASE_URL=$( [ "$NEW_DB" = 1 ] && echo "postgres://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME" )
SCM_API_KEY=$(openssl rand -hex 24)

# AI
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5-5
FAL_KEY=

# Ad platforms (redirect URL on each: https://$DOMAIN/api/connect/<platform>/callback)
META_APP_ID=
META_APP_SECRET=
META_API_VERSION=v25.0
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_API_VERSION=v25
GOOGLE_ADS_LOGIN_CUSTOMER_ID=
TIKTOK_APP_ID=
TIKTOK_APP_SECRET=
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_API_VERSION=202606
PINTEREST_CLIENT_ID=
PINTEREST_CLIENT_SECRET=
SNAPCHAT_CLIENT_ID=
SNAPCHAT_CLIENT_SECRET=
EOF
  chmod 600 "$ENV_FILE"
fi

echo "==> Nginx"
sudo tee /etc/nginx/sites-available/scm >/dev/null <<EOF
server {
  listen 80;
  server_name $DOMAIN;
  client_max_body_size 20m;
  location / {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 300s;
  }
}
EOF
sudo ln -sfn /etc/nginx/sites-available/scm /etc/nginx/sites-enabled/scm
sudo nginx -t && sudo systemctl reload nginx

echo "==> HTTPS certificate"
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || \
  echo "Certbot failed — check the domain's DNS points to this server, then run: sudo certbot --nginx -d $DOMAIN"

echo "==> Start pm2 on boot"
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null

cat <<EOF

Done. Next steps:
  1. Fill in your AI and ad-platform keys in $ENV_FILE (see README)
  2. First deploy:  bash $APP_DIR/repo/scripts/deploy.sh
  3. Add the GitHub secrets listed in README (Deploying) so pushes to main deploy automatically.
EOF
