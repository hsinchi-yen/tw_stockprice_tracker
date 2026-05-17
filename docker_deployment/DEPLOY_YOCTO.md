# TwStockPriceTracker — Yocto Deployment Guide (i.MX8M Mini)

## Prerequisites on the Yocto Device

| Requirement | How to verify |
|---|---|
| Docker daemon running | `docker info` |
| Internet access (to pull base images) | `ping 8.8.8.8` |
| `eth0` up with an IP assigned | `ip addr show eth0` |
| At least 1 GB free storage | `df -h` |
| `bash`, `ip`, `awk`, `sed` in PATH | pre-installed on most Yocto builds |

---

## Files Required on the Yocto Device

Transfer the following files/folders from Windows to the device,
keeping the directory structure intact:

```
TwStockPriceTracker/                 <-- project root
├── docker_deployment/
│   ├── Dockerfile.backend
│   ├── Dockerfile.frontend.yocto    <-- used by run_docker.sh for Yocto
│   ├── nginx-yocto.conf             <-- nginx config (host-network, proxies to 127.0.0.1)
│   ├── run_docker.sh
│   └── DEPLOY_YOCTO.md              <-- this file
├── server/
│   ├── index.ts
│   ├── db.ts
│   ├── StocksRouter.ts
│   └── ProxyService.ts
├── src/
│   ├── main.ts
│   ├── ApiClient.ts
│   ├── AlertEvaluator.ts
│   └── style.css
├── index.html
├── package.json
└── package-lock.json
```

> **Do NOT transfer:** `node_modules/`, `data/`, `dist/`, `.git/`,
> `docker-compose.yml`, `run.cmd` — they are either rebuilt on-device
> or not needed.

---

## Step 1 — Transfer Files from Windows

Open PowerShell on your Windows machine and run:

```powershell
# Replace 192.168.x.x with your device's eth0 IP
# Replace 'root' with the actual login user on the Yocto system

scp -r "C:\Users\lance.tn\AI Project\TwStockPriceTracker" root@192.168.x.x:/home/root/
```

If `rsync` is available on the Yocto build (faster, skips unwanted folders):

```bash
rsync -av \
  --exclude='node_modules' \
  --exclude='data' \
  --exclude='dist' \
  --exclude='.git' \
  --exclude='.agents' \
  "C:/Users/lance.tn/AI Project/TwStockPriceTracker/" \
  root@192.168.x.x:/home/root/TwStockPriceTracker/
```

---

## Step 2 — SSH into the Device

```bash
ssh root@192.168.x.x
```

---

## Step 3 — Deploy

Run the deployment script from the **project root**:

```bash
cd /home/root/TwStockPriceTracker

chmod +x docker_deployment/run_docker.sh

./docker_deployment/run_docker.sh
```

The script will:
1. Detect your `eth0` IP address
2. Stop and remove any previously running containers
3. Build the backend image (`node:20-alpine` + native `better-sqlite3`)
4. Build the frontend image (Vite static build + `nginx:alpine`)
5. Create an internal Docker bridge network (`twstock-net`)
6. Start the backend container (internal only, SQLite volume mounted)
7. Start the frontend/Nginx container (exposed on `eth0:8503`)

> **First-run build time:** Expect **10–20 minutes** on the i.MX8M Mini.
> The ARM CPU must pull base images and compile `better-sqlite3` natively.
> Subsequent deploys are much faster due to Docker layer caching.

---

## Step 4 — Verify

```bash
# Both containers must show as "Up"
docker ps

# Check application logs
docker logs twstock-backend
docker logs twstock-frontend

# Confirm port 8503 is listening on eth0
ss -tlnp | grep 8503
```

Then open a browser on any machine on the same network:

```
http://<eth0-ip>:8503
```

---

## Persistent Data

The SQLite database is stored at:

```
/home/root/TwStockPriceTracker/data/stocks.db
```

This path is bind-mounted into the backend container. Stock data survives
container restarts and image rebuilds.

---

## Auto-start on Boot

Both containers are launched with `--restart unless-stopped`, so they
restart automatically if Docker is already enabled at boot.

To check:

```bash
# systemd-based Yocto
systemctl is-enabled docker

# Start Docker on boot if not already enabled
systemctl enable docker
```

If containers are not running after a reboot, start them manually:

```bash
docker start twstock-backend twstock-frontend
```

---

## Redeploy After Source Update

After transferring updated source files from Windows:

```bash
cd /home/root/TwStockPriceTracker
./docker_deployment/run_docker.sh
```

The script stops old containers, rebuilds both images, and restarts everything.

---

## Useful Commands

```bash
# View running containers
docker ps

# Stop the application
docker stop twstock-frontend twstock-backend

# Remove containers (keeps images)
docker rm twstock-frontend twstock-backend

# Remove images to force a full rebuild
docker rmi twstock-frontend twstock-backend

# Tail live logs
docker logs -f twstock-backend
docker logs -f twstock-frontend

# Open a shell inside the backend container
docker exec -it twstock-backend sh
```
