@echo off
chcp 65001 >nul
if "%NVIDIA_API_KEY%"=="" set /p NVIDIA_API_KEY=Cole sua chave NVIDIA (nvapi-...): 
echo Abrindo em http://localhost:3000
start http://localhost:3000
node server.js
pause
