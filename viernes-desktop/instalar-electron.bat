@echo off
chcp 65001 >nul
title VIERNES Desktop - Instalador

echo.
echo ============================================
echo   VIERNES DESKTOP - Instalador
echo ============================================
echo.

echo Verificando Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js no esta instalado.
    echo Descargalo en: https://nodejs.org/
    echo.
    pause
    exit /b 1
)
echo OK: Node.js detectado
node --version
echo.

echo Instalando dependencias de Electron...
cd /d "%~dp0"
npm install
echo.
echo OK: Dependencias instaladas
echo.

pause

:menu
cls
echo.
echo ============================================
echo   VIERNES DESKTOP - Menu
echo ============================================
echo.
echo 1 - Ejecutar Viernes Desktop (desarrollo)
echo 2 - Construir instalador para Windows
echo 3 - Salir
echo.
set /p opcion="Elige una opcion (1-3): "
echo.

if "%opcion%"=="1" (
    echo Iniciando Viernes Desktop...
    echo Presiona Ctrl+C para detener.
    echo.
    npm start
    echo.
    echo Viernes Desktop se detuvo.
    pause
    goto :menu
)

if "%opcion%"=="2" (
    echo Construyendo instalador para Windows...
    echo Esto puede tardar varios minutos.
    echo.
    npm run build
    echo.
    if %errorlevel% equ 0 (
        echo OK: Instalador creado en viernes-desktop/dist\
    ) else (
        echo ERROR: Fallo la construccion.
    )
    pause
    goto :menu
)

if "%opcion%"=="3" (
    echo Saliendo...
    pause
    exit /b 0
)

echo Opcion invalida, intente de nuevo.
pause
goto :menu


