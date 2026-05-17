#!/bin/bash
# run_docker.sh — Deploy TwStockPriceTracker on i.MX8M Mini (Yocto, no docker-compose)
# Run this script from the PROJECT ROOT directory:
#   chmod +x docker_deployment/run_docker.sh
#   ./docker_deployment/run_docker.sh
#
# Uses --network host for both containers to avoid iptable_raw kernel module
# requirement introduced in Docker 28 direct-access-filtering.

set -e

BACKEND_IMAGE="twstock-backend"
FRONTEND_IMAGE="twstock-frontend"
BACKEND_CONTAINER="twstock-backend"
FRONTEND_CONTAINER="twstock-frontend"
DATA_DIR="$(pwd)/data"
APP_PORT=8503

echo "======================================================"
echo " TwStockPriceTracker — i.MX8M Mini Docker Deployment "
echo "======================================================"

# ── Check Docker is available ─────────────────────────────
if ! command -v docker &>/dev/null; then
    echo "ERROR: docker is not installed or not in PATH." >&2
    exit 1
fi

# ── Detect eth0 IP for display ────────────────────────────
ETH0_IP=$(ip addr show eth0 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d/ -f1 || true)
if [ -z "$ETH0_IP" ]; then
    echo "WARNING: Could not detect eth0 IP. Is eth0 up?"
else
    echo "Detected eth0 IP: $ETH0_IP"
fi

# ── Stop and remove existing containers ───────────────────
for container in "$FRONTEND_CONTAINER" "$BACKEND_CONTAINER"; do
    if docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
        echo "Stopping and removing: $container"
        docker stop "$container" 2>/dev/null || true
        docker rm   "$container" 2>/dev/null || true
    fi
done

# ── Remove leftover bridge network if present ─────────────
if docker network ls --format '{{.Name}}' | grep -q "^twstock-net$"; then
    docker network rm twstock-net 2>/dev/null || true
fi

# ── Create data directory for SQLite persistence ──────────
mkdir -p "$DATA_DIR"
echo "SQLite data directory: $DATA_DIR"

# ── Build images ──────────────────────────────────────────
echo ""
echo "[1/2] Building backend image (node:20-alpine + better-sqlite3)..."
docker build \
    -f docker_deployment/Dockerfile.backend \
    -t "$BACKEND_IMAGE" \
    .

echo ""
echo "[2/2] Building frontend image (Vite + nginx, Yocto host-network config)..."
docker build \
    -f docker_deployment/Dockerfile.frontend.yocto \
    -t "$FRONTEND_IMAGE" \
    .

# ── Start backend (host network, port 3000 on host) ───────
# --network host: no port mapping needed, no iptables raw table required
echo ""
echo "Starting backend container (host network, port 3000)..."
docker run -d \
    --name "$BACKEND_CONTAINER" \
    --network host \
    --restart unless-stopped \
    -v "$DATA_DIR:/app/data" \
    "$BACKEND_IMAGE"

# ── Start frontend/Nginx (host network, port 8503 on host) ─
# Nginx proxies /api/ to 127.0.0.1:3000 (backend on same host network)
echo "Starting frontend container (host network, port $APP_PORT)..."
docker run -d \
    --name "$FRONTEND_CONTAINER" \
    --network host \
    --restart unless-stopped \
    "$FRONTEND_IMAGE"

# ── Done ──────────────────────────────────────────────────
echo ""
echo "======================================================"
echo " Deployment complete!"
if [ -n "$ETH0_IP" ]; then
    echo " Open:  http://${ETH0_IP}:${APP_PORT}"
fi
echo " Logs:  docker logs $BACKEND_CONTAINER"
echo "        docker logs $FRONTEND_CONTAINER"
echo " Stop:  docker stop $BACKEND_CONTAINER $FRONTEND_CONTAINER"
echo "======================================================"
