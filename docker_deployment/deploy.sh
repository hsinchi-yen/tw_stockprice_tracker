#!/bin/bash
# Remote deploy script — no docker-compose, host network, bind-mount for SQLite.
# Run from /root/TWSTOCKPRICETRACKER/ after scp-ing the .tar image files here.
set -e

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="$DEPLOY_DIR/data"
BACKEND_TAR="$DEPLOY_DIR/twstock-backend.tar"
FRONTEND_TAR="$DEPLOY_DIR/twstock-frontend.tar"

echo "=== TW Stock Tracker Deploy ==="
echo "Deploy dir : $DEPLOY_DIR"
echo "Data dir   : $DATA_DIR"

# ── 1. Stop and remove existing containers ────────────────────────────────────
echo ""
echo "[1/6] Stopping old containers..."
docker stop twstock-backend  2>/dev/null && echo "  stopped twstock-backend"  || echo "  twstock-backend not running"
docker stop twstock-frontend 2>/dev/null && echo "  stopped twstock-frontend" || echo "  twstock-frontend not running"

docker rm   twstock-backend  2>/dev/null && echo "  removed twstock-backend"  || echo "  twstock-backend not present"
docker rm   twstock-frontend 2>/dev/null && echo "  removed twstock-frontend" || echo "  twstock-frontend not present"

# ── 2. Load new images from tar archives ─────────────────────────────────────
echo ""
echo "[2/6] Loading images..."
[ -f "$BACKEND_TAR"  ] && docker load < "$BACKEND_TAR"  || { echo "ERROR: $BACKEND_TAR not found"; exit 1; }
[ -f "$FRONTEND_TAR" ] && docker load < "$FRONTEND_TAR" || { echo "ERROR: $FRONTEND_TAR not found"; exit 1; }

# ── 3. Ensure data directory exists ──────────────────────────────────────────
echo ""
echo "[3/6] Ensuring data dir exists: $DATA_DIR"
mkdir -p "$DATA_DIR"

# ── 4. Run backend (host network, persist SQLite DB) ─────────────────────────
echo ""
echo "[4/6] Starting twstock-backend..."
docker run -d \
  --name twstock-backend \
  --network host \
  --restart unless-stopped \
  -v "$DATA_DIR:/app/data" \
  twstock-backend:latest
echo "  twstock-backend started"

# ── 5. Run frontend (host network, nginx proxies /api/ → 127.0.0.1:3000) ─────
echo ""
echo "[5/6] Starting twstock-frontend..."
docker run -d \
  --name twstock-frontend \
  --network host \
  --restart unless-stopped \
  twstock-frontend:latest
echo "  twstock-frontend started"

# ── 6. Wait and verify ────────────────────────────────────────────────────────
echo ""
echo "[6/6] Waiting 8 s for services to initialise..."
sleep 8

echo ""
echo "=== Container status ==="
docker ps --filter "name=twstock" --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "=== Health check ==="
if curl -sf http://localhost:3000/api/health > /dev/null; then
  echo "  Backend  (3000) : OK"
else
  echo "  Backend  (3000) : FAILED — check: docker logs twstock-backend"
  exit 2
fi

if curl -sf http://localhost:8503/ -o /dev/null; then
  echo "  Frontend (8503) : OK"
else
  echo "  Frontend (8503) : FAILED — check: docker logs twstock-frontend"
  exit 2
fi

echo ""
echo "=== Deploy complete ==="
