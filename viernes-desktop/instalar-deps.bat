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
echo Dependencias instaladas.
pause

