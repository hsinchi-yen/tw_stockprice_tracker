@echo off
chcp 65001 > nul
echo ==============================================
echo  TW Stock Price Tracker Starting...
echo ==============================================

echo [1/2] Starting Node.js Proxy Server...
start "TW Stock Backend" cmd /k "npm run dev:server"

echo [2/2] Starting Vite Frontend UI...
start "TW Stock Frontend" cmd /k "npm run dev:ui"

echo.
echo Both services have been started!
echo Please go to http://localhost:5173 in your browser.
echo.
echo Keep the two new terminal windows open to run the app.
echo Close them to stop the services.
echo ----------------------------------------------
pause
