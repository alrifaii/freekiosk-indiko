@echo off
setlocal
rem ============================================================
rem  Notfall ohne Kit-Server: dieselben Hilfen wie die Seite "USB"
rem  im inDiKo Kit, falls Start.bat nicht laeuft. Nur per USB-Kabel,
rem  ohne Internet. Sucht adb.exe hier, im Kit-Ordner und in
rem  platform-tools daneben.
rem ============================================================

set ADB=adb
if exist "%~dp0adb.exe" set ADB="%~dp0adb.exe"
if exist "%~dp0..\adb.exe" set ADB="%~dp0..\adb.exe"
if exist "%~dp0..\platform-tools\adb.exe" set ADB="%~dp0..\platform-tools\adb.exe"
if exist "%~dp0platform-tools\adb.exe" set ADB="%~dp0platform-tools\adb.exe"

:start
echo.
echo Suche Tablet per USB...
%ADB% get-state >nul 2>&1
if errorlevel 1 (
    echo.
    echo  Kein Tablet gefunden. Kabel anstecken und am Tablet
    echo  "USB-Debugging zulassen" bestaetigen. Dann eine Taste druecken.
    echo  Fehlt adb: im Kit unter USB auf "Laden" klicken.
    pause >nul
    goto :start
)

:menu
echo.
echo ================== NOTFALL ==================
echo   1  Bluetooth AUS   (Taster trennen, Tastatur kommt)
echo   2  Bluetooth AN
echo   3  Tastatur erzwingen (auch mit Taster)
echo   4  PIN senden      (vorher ins PIN-Feld tippen)
echo   5  Bildschirm wecken
echo   6  Rechte nachruesten (Akku, Tastatur, Statistik)
echo   7  Gekoppelte Geraete anzeigen
echo   0  Beenden
echo =============================================
set CH=
set /p CH=Auswahl:

if "%CH%"=="1" ( %ADB% shell cmd bluetooth_manager disable & goto :menu )
if "%CH%"=="2" ( %ADB% shell cmd bluetooth_manager enable & goto :menu )
if "%CH%"=="3" ( %ADB% shell settings put secure show_ime_with_hard_keyboard 1 & goto :menu )
if "%CH%"=="4" goto :pin
if "%CH%"=="5" ( %ADB% shell input keyevent 224 & goto :menu )
if "%CH%"=="6" (
    %ADB% shell appops set com.freekiosk android:get_usage_stats allow
    %ADB% shell pm grant com.freekiosk android.permission.WRITE_SECURE_SETTINGS
    %ADB% shell dumpsys deviceidle whitelist +com.freekiosk
    %ADB% shell settings put secure show_ime_with_hard_keyboard 1
    goto :menu
)
if "%CH%"=="7" ( %ADB% shell "dumpsys bluetooth_manager | grep -A 12 'Bonded devices'" & goto :menu )
if "%CH%"=="0" exit /b 0
echo Ungueltige Auswahl.
goto :menu

:pin
set PIN=
set /p PIN=PIN:
echo %PIN%| findstr /r "^[0-9][0-9][0-9][0-9][0-9]*$" >nul || ( echo Nur Ziffern. & goto :menu )
%ADB% shell input text %PIN%
%ADB% shell input keyevent 66
goto :menu
