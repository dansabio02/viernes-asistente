@echo off
chcp 65001 >nul
title VIERNES Desktop - Instalador

echo.
echo   ============================================
echo     VIERNES DESKTOP - Instalador
echo   ============================================
echo.

rem Verificar si Node.js esta instalado
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no esta instalado.
    echo.
    echo Por favor, descarga e instala Node.js desde:
    echo   https://nodejs.org/
    echo.
    echo Despues de instalar, ejecuta este archivo nuevamente.
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js detectado: %cd%
node --version

echo.
echo Instalando dependencias de Electron...
cd /d "%~dp0"
npm install

if %errorlevel% neq 0 (
    echo [ERROR] Fallo la instalacion de dependencias.
    pause
    exit /b 1
)

echo.
echo [OK] Dependencias instaladas correctamente.
echo.

echo Opciones:
echo   1. Ejecutar Viernes Desktop (desarrollo)
echo   2. Construir instalador para Windows (produccion)
echo   3. Salir
echo.
set /p opcion="Elige una opcion (1-3): "

if "%opcion%"=="1" (
    echo.
    echo Iniciando Viernes Desktop...
    npm start
) else if "%opcion%"=="2" (
    echo.
    echo Construyendo instalador para Windows...
    npm run build
    echo.
    echo El instalador estara en viernes-desktop/dist/
) else (
    echo Saliendo...
)

pause

