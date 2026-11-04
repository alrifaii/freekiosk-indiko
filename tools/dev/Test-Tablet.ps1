# inDiKo: build FreeKiosk on this laptop and put it on a test tablet over Wi-Fi.
# No GitHub run, no factory reset: the app is updated in place, Device Owner and all
# settings stay. Needs Android Studio (JDK and Android SDK) and Node 20 once.
#
#   Test-Tablet.bat                      build, ask for the tablet, install
#   Test-Tablet.bat 192.168.1.50:37123   build and install on that tablet
#   Test-Tablet.bat -NoBuild ...         install the last build again
#   Test-Tablet.bat -Pin 1234 -AdminKey <key> ...   also hand the kit key to the tablet
#
# The tablet needs wireless debugging once (see LIESMICH, "WLAN-Debugging"): pair with
#   adb pair IP:PAIRPORT CODE
# and use the port shown on the Wireless debugging page here.
param(
    [string]$Tablet = "",
    [switch]$NoBuild,
    [string]$Pin = "",
    [string]$AdminKey = ""
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$apk = Join-Path $repo 'android\app\build\outputs\apk\release\app-release.apk'

function Find-Adb {
    $candidates = @()
    if ($env:ANDROID_HOME) { $candidates += (Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe') }
    if ($env:ANDROID_SDK_ROOT) { $candidates += (Join-Path $env:ANDROID_SDK_ROOT 'platform-tools\adb.exe') }
    $candidates += (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe')
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    $cmd = Get-Command adb -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

$adb = Find-Adb
if (-not $adb) {
    Write-Host '  adb nicht gefunden. Android Studio installieren (bringt das Android SDK mit).' -ForegroundColor Red
    exit 1
}

if (-not $NoBuild) {
    # Gradle needs Java and the SDK; Android Studio brings both but does not announce them
    if (-not $env:JAVA_HOME -and -not (Get-Command java -ErrorAction SilentlyContinue)) {
        $jbr = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'
        if (Test-Path $jbr) { $env:JAVA_HOME = $jbr } else {
            Write-Host '  Java fehlt. Android Studio installieren (enthaelt Java).' -ForegroundColor Red
            exit 1
        }
    }
    if (-not $env:ANDROID_HOME) {
        $sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
        if (Test-Path $sdk) { $env:ANDROID_HOME = $sdk }
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host '  Node.js fehlt (Version 20): https://nodejs.org' -ForegroundColor Red
        exit 1
    }
    Push-Location $repo
    try {
        if (-not (Test-Path (Join-Path $repo 'node_modules'))) {
            Write-Host '  Einmalig: npm ci (dauert ein paar Minuten)'
            npm ci
            if ($LASTEXITCODE -ne 0) { throw 'npm ci fehlgeschlagen' }
        }
        Set-Location (Join-Path $repo 'android')
        Write-Host '  Baue FreeKiosk (erstes Mal ca. 10 Minuten, danach 1 bis 3) ...'
        & .\gradlew.bat assembleRelease -Pcloudprovi
        if ($LASTEXITCODE -ne 0) { throw 'Build fehlgeschlagen, Meldung oben lesen' }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path $apk)) {
    Write-Host "  Keine APK unter $apk. Erst ohne -NoBuild starten." -ForegroundColor Red
    exit 1
}

if (-not $Tablet) {
    $Tablet = Read-Host '  Tablet (IP:Port von der Seite Wireless-Debugging)'
}
if ($Tablet) {
    & $adb connect $Tablet | Out-Host
}
$target = @()
if ($Tablet) { $target = @('-s', $Tablet) }

Write-Host '  Installiere als Update (Device Owner und Einstellungen bleiben) ...'
& $adb @target install -r $apk | Out-Host
if ($LASTEXITCODE -ne 0) {
    Write-Host '  Installieren fehlgeschlagen. "UPDATE_INCOMPATIBLE" heisst: andere Signatur als die App am Tablet.' -ForegroundColor Red
    exit 1
}

$extras = @()
if ($Pin -and $AdminKey) { $extras = @('--es', 'pin', $Pin, '--es', 'mqtt_admin_key', $AdminKey) }
& $adb @target shell am start -n com.freekiosk/.MainActivity @extras | Out-Host
Write-Host ''
Write-Host '  Fertig. FreeKiosk laeuft mit dem neuen Stand.' -ForegroundColor Green
