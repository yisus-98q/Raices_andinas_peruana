@echo off
rem ---------------------------------------------------------------------------
rem  Abre Raiz Andina: levanta el servidor y abre la tienda en el navegador.
rem  Doble clic y listo. Para apagarlo, cierra esta ventana (o Ctrl+C).
rem ---------------------------------------------------------------------------
setlocal
title Raiz Andina - servidor
cd /d "%~dp0"

rem 1. Node instalado y en version 22.5 o mas (usa node:sqlite).
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo  No encuentro Node.js. Instalalo desde https://nodejs.org ^(version 22 o mas^)
  echo  y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)"
if errorlevel 1 (
  echo.
  echo  Tu Node.js es muy antiguo. Hace falta la version 22.5 o mas nueva.
  node -v
  echo.
  pause
  exit /b 1
)

rem 2. Dependencias, solo la primera vez (necesita internet esa unica vez).
if not exist "node_modules\qrcode" (
  echo  Instalando dependencias por primera vez...
  call npm install --omit=dev
  if errorlevel 1 (
    echo  No se pudieron instalar las dependencias. Revisa la conexion.
    pause
    exit /b 1
  )
)

rem 3. El puerto: el del .env si lo tiene, si no 4000.
set "PUERTO=4000"
if exist ".env" (
  for /f "tokens=1,* delims==" %%a in ('findstr /b /c:"PORT=" ".env"') do set "PUERTO=%%b"
)
set "URL=http://localhost:%PUERTO%"

rem 4. Si ya esta corriendo, solo se abre el navegador.
netstat -ano | findstr /r /c:":%PUERTO% .*LISTENING" >nul
if not errorlevel 1 (
  echo  Raiz Andina ya esta abierto en %URL%
  start "" "%URL%"
  timeout /t 3 >nul
  exit /b 0
)

rem 5. Abre el navegador en cuanto el servidor responda (en segundo plano)...
start "" /b powershell -NoProfile -WindowStyle Hidden -Command ^
  "for($i=0;$i -lt 60;$i++){try{Invoke-WebRequest -UseBasicParsing '%URL%/api/tienda' -TimeoutSec 1 | Out-Null; Start-Process '%URL%'; break}catch{Start-Sleep -Milliseconds 500}}"

rem ...y el servidor queda en esta ventana, con su registro a la vista.
echo.
echo  Abriendo Raiz Andina en %URL%
echo  Panel: %URL%/admin.html
echo  Para apagarlo, cierra esta ventana.
echo.
node server.js

echo.
echo  El servidor se detuvo.
pause
