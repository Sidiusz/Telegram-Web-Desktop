@echo off
setlocal
cd /d "%~dp0"
title Telegram Web Desktop - build

echo.
echo === [1/3] Stopping running instances ===
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=(Get-Location).Path; $match={ ($_.Path -and $_.Path.StartsWith($root,'OrdinalIgnoreCase')) -or ($_.ProcessName -eq 'Telegram Web Desktop') }; $ps=@(Get-Process -ErrorAction SilentlyContinue | Where-Object $match); if($ps.Count -eq 0){ Write-Host '  nothing to stop'; exit 0 }; Write-Host ('  stopping ' + $ps.Count + ' process(es)'); $ps | ForEach-Object { try { $_.CloseMainWindow() | Out-Null } catch {} }; Start-Sleep -Milliseconds 700; $ps=@(Get-Process -ErrorAction SilentlyContinue | Where-Object $match); if($ps.Count){ $ps | Stop-Process -Force -ErrorAction SilentlyContinue }; for($i=0; $i -lt 40; $i++){ if(@(Get-Process -ErrorAction SilentlyContinue | Where-Object $match).Count -eq 0){ break }; Start-Sleep -Milliseconds 250 }; if(@(Get-Process -ErrorAction SilentlyContinue | Where-Object $match).Count){ Write-Host '  WARNING: some processes are still alive'; exit 1 }; Write-Host '  all stopped'"
if errorlevel 1 (
    echo.
    echo Could not stop every instance. Close the app manually and run this again.
    goto :fail
)

echo.
echo === [2/3] Clearing dist\win-unpacked ===
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d='dist\win-unpacked'; if(-not (Test-Path $d)){ Write-Host '  nothing to clear'; exit 0 }; for($i=0; $i -lt 12; $i++){ try { Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction Stop; Write-Host '  cleared'; exit 0 } catch { Start-Sleep -Milliseconds 500 } }; Write-Host '  WARNING: folder is locked by another process'; exit 1"
if errorlevel 1 (
    echo.
    echo dist\win-unpacked is still locked - a file explorer or antivirus may be holding it.
    goto :fail
)

echo.
echo === [3/3] Building release ===
call npm.cmd run build
if errorlevel 1 goto :fail

echo.
echo === Build OK ===
for %%f in ("dist\*Setup*.exe") do echo   %%~ff  (%%~zf bytes)

if /i "%~1"=="run" (
    echo.
    echo Starting the built app...
    rem Start-Process detaches: the app must not keep this console's pipes open.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'dist\win-unpacked\Telegram Web Desktop.exe'"
)

echo.
if "%~1"=="" pause
exit /b 0

:fail
echo.
echo === Build FAILED ===
if "%~1"=="" pause
exit /b 1
