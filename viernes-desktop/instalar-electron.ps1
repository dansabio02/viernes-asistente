# VIERNES Desktop - Instalador (PowerShell)
# Ejecutar con: clic derecho -> Ejecutar con PowerShell
# O desde terminal: powershell -ExecutionPolicy Bypass -File viernes-desktop\instalar-electron.ps1

Write-Host ""
Write-Host "=========================================="
Write-Host "  VIERNES DESKTOP - Instalador"
Write-Host "=========================================="
Write-Host ""

# Verificar Node.js
Write-Host "Verificando Node.js..."
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "ERROR: Node.js no esta instalado." -ForegroundColor Red
    Write-Host "Descargalo en: https://nodejs.org/"
    Write-Host ""
    Read-Host "Presiona Enter para salir"
    exit 1
}
Write-Host "OK: Node.js detectado ($($node.Version))"
Write-Host ""

# Instalar dependencias
Write-Host "Instalando dependencias de Electron..."
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Push-Location $scriptDir
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Fallo la instalacion de dependencias." -ForegroundColor Red
    Write-Host ""
    Read-Host "Presiona Enter para volver al menu"
    goto menu
}
Write-Host "OK: Dependencias instaladas"
Write-Host ""

:menu
cls
Write-Host ""
Write-Host "=========================================="
Write-Host "  VIERNES DESKTOP - Menu"
Write-Host "=========================================="
Write-Host ""
Write-Host "1 - Ejecutar Viernes Desktop (desarrollo)"
Write-Host "2 - Construir instalador para Windows"
Write-Host "3 - Salir"
Write-Host ""
$opcion = Read-Host "Elige una opcion (1-3)"

switch ($opcion) {
    "1" {
        Write-Host ""
        Write-Host "Iniciando Viernes Desktop..."
        Write-Host "Presiona Ctrl+C para detener."
        Write-Host ""
        npm start
        Write-Host ""
        Write-Host "Viernes Desktop se detuvo."
        Read-Host "Presiona Enter para volver al menu"
        goto menu
    }
    "2" {
        Write-Host ""
        Write-Host "Construyendo instalador para Windows..."
        Write-Host "Esto puede tardar varios minutos."
        Write-Host ""
        npm run build
        if ($LASTEXITCODE -eq 0) {
            Write-Host "OK: Instalador creado en viernes-desktop/dist\" -ForegroundColor Green
        } else {
            Write-Host "ERROR: Fallo la construccion." -ForegroundColor Red
        }
        Read-Host "Presiona Enter para volver al menu"
        goto menu
    }
    "3" {
        Write-Host "Saliendo..."
        Read-Host "Presiona Enter para salir"
        exit 0
    }
    default {
        Write-Host "Opcion invalida, intente de nuevo."
        Read-Host "Presiona Enter para continuar"
        goto menu
    }
}
