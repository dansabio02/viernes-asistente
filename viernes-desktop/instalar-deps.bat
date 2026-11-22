@echo off
chcp 65001 >nul
title VIERNES Desktop - Instalador de dependencias
echo ============================================
echo   VIERNES DESKTOP - Instalando dependencias
echo ============================================
echo.
cd /d "%~dp0"
npm install
echo.
echo Aprobando scripts de instalacion de Electron...
npm install-scripts approve electron@latest
echo.
echo Dependencias instaladas correctamente.
echo.
pause

