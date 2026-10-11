@echo off
chcp 65001 >nul
title VIERNES - Servidor local
cd /d "%~dp0"
echo.
echo   ============================================
echo     VIERNES · Asistente personal
echo     Iniciando servidor local...
echo   ============================================
echo.
echo   Abre tu navegador en:  http://localhost:8000
echo   Manten esta ventana ABIERTA mientras uses a VIERNES.
echo   Para detener: presiona Ctrl + C
echo.
start "" "http://localhost:8000"
python -m http.server 8000
pause
