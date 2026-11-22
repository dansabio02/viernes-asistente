@echo off
chcp 65001 >nul
title VIERNES Desktop
echo ============================================
echo   VIERNES DESKTOP - Iniciando...
echo ============================================
echo.
cd /d "%~dp0"
echo Ejecutando Viernes Desktop...
echo Presiona Ctrl+C para detener.
echo.
npm start
echo.
echo Viernes Desktop se detuvo.
pause

