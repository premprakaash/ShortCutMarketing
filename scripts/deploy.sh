#!/usr/bin/env bash
# Deploy one commit of ShortCut Marketing on the server.
#
#   bash deploy.sh <commit-sha>      (called by GitHub Actions)
#   bash deploy.sh                   (deploys the latest origin/main)
#
# Layout under $APP_DIR (default /var/www/scm):
#   repo/                 git clone used to fetch code
#   shared/.env.local     production settings (never in git)
#   releases/<sha>/       one folder per deployed commit
#   current -> releases/<sha>   what pm2 runs
#
# Each release is built in its own folder while the old one keeps serving,
# then `current` is switched over and pm2 reloads. If the new version
# doesn't answer its health check, it rolls back automatically.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/scm}"
APP_NAME="${APP_NAME:-scm}"
PORT="${PORT:-3000}"
BRANCH="${BRANCH:-main}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT}/connections}"

log() { printf '\n==> %s\n' "$*"; }

REPO="$APP_DIR/repo"
SHARED="$APP_DIR/shared"
RELEASES="$APP_DIR/releases"
CURRENT="$APP_DIR/current"

[ -d "$REPO/.git" ] || { echo "No git clone at $REPO. Run the first-time setup in README (Deploying)."; exit 1; }
[ -f "$SHARED/.env.local" ] || { echo "Missing $SHARED/.env.local with production settings."; exit 1; }
mkdir -p "$RELEASES"

log "Fetching code"
git -C "$REPO" fetch --quiet --depth 50 origin "$BRANCH"
SHA="${1:-$(git -C "$REPO" rev-parse "origin/$BRANCH")}"
if ! git -C "$REPO" cat-file -e "$SHA^{commit}" 2>/dev/null; then
  git -C "$REPO" fetch --quiet --depth 1 origin "$SHA"
fi
SHA="$(git -C "$REPO" rev-parse "$SHA^{commit}")"
SHORT="${SHA:0:7}"
RELEASE="$RELEASES/$SHA"

PREVIOUS=""
[ -L "$CURRENT" ] && PREVIOUS="$(readlink -f "$CURRENT")"
# Only a release that passed its health check counts as a rollback target.
ROLLBACK=""
[ -n "$PREVIOUS" ] && [ -f "$PREVIOUS/.healthy" ] && [ "$PREVIOUS" != "$RELEASE" ] && ROLLBACK="$PREVIOUS"
if [ "$PREVIOUS" = "$RELEASE" ] && [ -f "$RELEASE/.healthy" ]; then
  log "Commit $SHORT is already live — nothing to do"
  exit 0
fi

log "Building release $SHORT"
rm -rf "$RELEASE"
mkdir -p "$RELEASE"
git -C "$REPO" archive "$SHA" | tar -x -C "$RELEASE"
ln -sfn "$SHARED/.env.local" "$RELEASE/.env.local"
echo "$SHA" > "$RELEASE/REVISION"
cd "$RELEASE"
npm ci --no-audit --no-fund
NEXT_TELEMETRY_DISABLED=1 npm run build

switch_to() {
  ln -sfn "$1" "$CURRENT.tmp"
  mv -Tf "$CURRENT.tmp" "$CURRENT"
  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    pm2 reload "$APP_NAME" --update-env
  else
    PORT="$PORT" pm2 start npm --name "$APP_NAME" --cwd "$CURRENT" -- start
  fi
  pm2 save >/dev/null
}

healthy() {
  for _ in $(seq 1 30); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" || true)"
    [ "$code" = "200" ] && return 0
    sleep 2
  done
  return 1
}

log "Switching to $SHORT"
switch_to "$RELEASE"

log "Health check: $HEALTH_URL"
if healthy; then
  touch "$RELEASE/.healthy"
  log "Deployed $SHORT ✔"
else
  echo "New release failed its health check."
  if [ -n "$ROLLBACK" ] && [ -d "$ROLLBACK" ]; then
    log "Rolling back to $(basename "$ROLLBACK" | cut -c1-7)"
    switch_to "$ROLLBACK"
  fi
  pm2 logs "$APP_NAME" --lines 40 --nostream || true
  exit 1
fi

log "Cleaning up old releases (keeping $KEEP_RELEASES)"
LIVE="$(readlink -f "$CURRENT")"
ls -1dt "$RELEASES"/*/ 2>/dev/null | sed 's:/$::' | tail -n +"$((KEEP_RELEASES + 1))" | while read -r old; do
  [ "$old" != "$LIVE" ] && rm -rf "$old"
done
