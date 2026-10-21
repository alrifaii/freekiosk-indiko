@echo off
rem FreeKiosk QR-Kit: startet den kleinen Webserver und oeffnet die Oberflaeche im Browser.
cd /d "%~dp0"
title FreeKiosk QR-Kit
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
set RC=%errorlevel%
if "%RC%"=="2" goto ende
if %RC% geq 1 (
  echo.
  echo   Der PowerShell-Server konnte nicht starten. Versuche Python ...
  where py >nul 2>nul && ( py "%~dp0server.py" & goto ende )
  where python >nul 2>nul && ( python "%~dp0server.py" & goto ende )
  echo   Python ist nicht installiert. Bitte die Meldung oben an den Support schicken.
)
:ende
echo.
pause
