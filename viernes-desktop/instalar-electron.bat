@echo off
chcp 65001 >nul
title VIERNES Desktop - Instalador

:menu
cls
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

echo [OK] Node.js detectado
node --version
echo.

echo Instalando/actualizando dependencias de Electron...
cd /d "%~dp0"
npm install

if %errorlevel% neq 0 (
    echo [ERROR] Fallo la instalacion de dependencias.
    echo.
    pause
    goto :menu
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
echo.

if "%opcion%"=="1" (
    echo.
    echo Iniciando Viernes Desktop...
    echo Presiona Ctrl+C en esta ventana para detener Viernes.
    echo.
    npm start
    echo.
    echo Viernes Desktop se ha detenido.
    pause
) else if "%opcion%"=="2" (
    echo.
    echo Construyendo instalador para Windows...
    echo Esto puede tardar varios minutos...
    echo.
    npm run build
    echo.
    if %errorlevel% equ 0 (
        echo [OK] Instalador construido correctamente.
        echo El instalador esta en: viernes-desktop\dist\
    ) else (
        echo [ERROR] Fallo la construccion del instalador.
    )
    echo.
    pause
) else if "%opcion%"=="3" (
    echo Saliendo...
    exit /b 0
) else (
    echo Opcion no valida.
    pause
)

goto :menu

