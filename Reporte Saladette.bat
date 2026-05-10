@echo off
cd /d "%~dp0"
echo Generando Reporte Saladette...
node generate-saladette.js
if %errorlevel% == 0 (
    echo.
    echo Abriendo reporte...
    for /f "delims=" %%f in ('dir /b /od "Info para Claude\Reportes\Empaque\Reporte Saladette*.pdf" 2^>nul') do set LAST=%%f
    if defined LAST start "" "Info para Claude\Reportes\Empaque\%LAST%"
) else (
    echo ERROR al generar el reporte.
    pause
)
