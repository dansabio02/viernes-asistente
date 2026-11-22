@echo off
chcp 65001 >nul
title VIERNES Desktop - Instalador

echo.
echo   ============================================
echo     VIERNES DESKTOP - Instalador
echo   ============================================
echo.

echo Verificando Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no esta instalado.
    echo Descargalo en: https://nodejs.org/
    echo.
    pause
    exit /b 1
)
echo [OK] Node.js detectado
node --version
echo.

echo Instalando dependencias de Electron...
cd /d "%~dp0"
npm install
echo.
echo [OK] Dependencias instaladas
echo.

:opcion
echo Elija una opcion:
echo   1 - Ejecutar Viernes Desktop (desarrollo)
echo   2 - Construir instalador para Windows
echo   3 - Salir
echo.
set /p opcion="Opcion (1-3): "

if "%opcion%"=="1" goto :ejecutar
if "%opcion%"=="2" goto :construir
if "%opcion%"=="3" goto :salir

echo Opcion invalida, intente de nuevo.
echo.
goto :opcion

:ejecutar
echo.
echo Iniciando Viernes Desktop...
echo Presione Ctrl+C en la consola para detener.
echo.
npm start
echo.
echo Viernes Desktop se detuvo.
pause
goto :menu

:construir
echo.
echo Construyendo instalador para Windows...
echo Esto puede tardar varios minutos.
echo.
npm run build
echo.
if %errorlevel% equ 0 (
    echo [OK] Instalador creado en viernes-desktop\dist\
) else (
    echo [ERROR] Fallo la construccion.
)
pause
goto :menu

:menu
cls
goto :opcion

:salir
echo Saliendo...
pause
exit /b 0

