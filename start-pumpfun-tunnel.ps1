# start-pumpfun-tunnel.ps1
# Levanta el backend Genesis (con Pump.fun Alpha) + un tunel Cloudflare gratis,
# y te muestra la URL publica para pegar en vercel.json (VITE_API_BASE).
#
# Uso:  click derecho -> "Ejecutar con PowerShell"   (o)   ./start-pumpfun-tunnel.ps1
# Para detener: cierra esta ventana.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$port = 8790
$cf   = Join-Path $root ".tunnel\cloudflared.exe"

# 0) Descargar cloudflared si falta
if (-not (Test-Path $cf)) {
  New-Item -ItemType Directory (Split-Path $cf) -Force | Out-Null
  Write-Host "Descargando cloudflared..." -ForegroundColor Cyan
  Invoke-WebRequest "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cf
}

# 1) Backend (incluye solana-alpha por import dinamico)
Write-Host "Arrancando backend en :$port ..." -ForegroundColor Cyan
$env:PORT = "$port"
$server = Start-Process node -ArgumentList "--env-file-if-exists=.env","server/index.mjs" -WorkingDirectory $root -PassThru -WindowStyle Minimized

Start-Sleep -Seconds 8

# 2) Tunel
Write-Host "Abriendo tunel Cloudflare..." -ForegroundColor Cyan
$log = Join-Path $root ".tunnel\tunnel.log"
if (Test-Path $log) { Remove-Item $log -Force }
$tunnel = Start-Process $cf -ArgumentList "tunnel","--url","http://localhost:$port","--no-autoupdate" -WorkingDirectory $root -PassThru -RedirectStandardError $log -WindowStyle Minimized

# 3) Esperar y extraer la URL
$url = $null
foreach ($i in 1..20) {
  Start-Sleep -Seconds 1
  if (Test-Path $log) {
    $m = Select-String -Path $log -Pattern "https://[a-zA-Z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value; break }
  }
}

Write-Host ""
if ($url) {
  Write-Host "================================================================" -ForegroundColor Green
  Write-Host " LISTO. URL publica del backend:" -ForegroundColor Green
  Write-Host "   $url" -ForegroundColor Yellow
  Write-Host ""
  Write-Host " Verifica:  $url/api/solana/status" -ForegroundColor Gray
  Write-Host ""
  Write-Host " Para que la app de Vercel lo use, pon esa URL en vercel.json:" -ForegroundColor Green
  Write-Host '   "VITE_API_BASE": "' -NoNewline -ForegroundColor Gray; Write-Host "$url" -NoNewline -ForegroundColor Yellow; Write-Host '"' -ForegroundColor Gray
  Write-Host " ...haz commit + push y Vercel reconstruye." -ForegroundColor Green
  Write-Host "================================================================" -ForegroundColor Green
} else {
  Write-Host "No se pudo obtener la URL del tunel. Revisa $log" -ForegroundColor Red
}

Write-Host ""
Write-Host "Deja esta ventana ABIERTA para mantener el backend + tunel vivos." -ForegroundColor Magenta
Write-Host "Ctrl+C o cerrar la ventana = se apaga todo." -ForegroundColor Magenta
Write-Host "PIDs -> server:$($server.Id)  tunnel:$($tunnel.Id)"

# Mantener vivo
Wait-Process -Id $tunnel.Id
