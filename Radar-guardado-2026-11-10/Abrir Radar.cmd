@echo off
cd /d "%~dp0"
set "RADAR_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%RADAR_NODE%" set "RADAR_NODE=node"
if not defined RADAR_PORT set "RADAR_PORT=8903"
if not defined GONDOLUPA_CATALOG_PILOT set "GONDOLUPA_CATALOG_PILOT=1"
echo Abri http://localhost:%RADAR_PORT% en tu navegador. Deja esta ventana abierta mientras uses Radar.
"%RADAR_NODE%" --use-system-ca --use-env-proxy work\benchmark-server.cjs --open
pause
