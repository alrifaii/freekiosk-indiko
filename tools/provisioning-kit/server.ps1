# inDiKo Kit - kleiner Webserver fuer Windows (PowerShell 5.1 und neuer).
# Liefert die Oberflaeche (web\) und die FreeKiosk-APK an Browser und Tablets aus und
# fuehrt fuer die USB-Seite adb-Befehle aus (nur fuer Anfragen von diesem Laptop).
# Braucht keine Installation und keine Adminrechte; die Windows-Firewall fragt beim
# ersten Start einmal nach, ob Tablets im Netzwerk zugreifen duerfen.
# Diese Datei bleibt reines ASCII: PowerShell 5.1 liest Skripte ohne BOM als ANSI.

param(
    [int]$Port = 8080,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$webDir = Join-Path $root 'web'

$apk = Get-ChildItem -Path $root -Filter '*.apk' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $apk) {
    Write-Host ''
    Write-Host '  Keine .apk-Datei im Ordner gefunden.' -ForegroundColor Red
    Write-Host "  Bitte die FreeKiosk-APK neben Start.bat legen: $root"
    exit 2
}

$config = @{}
$configPath = Join-Path $root 'config.json'
if (Test-Path $configPath) {
    try {
        $parsed = Get-Content -Raw -Path $configPath | ConvertFrom-Json
        foreach ($p in $parsed.PSObject.Properties) { $config[$p.Name] = $p.Value }
    } catch {
        Write-Host "  config.json konnte nicht gelesen werden: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function Get-LanAddresses {
    $result = @()
    foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
        if ($nic.OperationalStatus -ne 'Up') { continue }
        if ($nic.NetworkInterfaceType -eq 'Loopback') { continue }
        foreach ($ua in $nic.GetIPProperties().UnicastAddresses) {
            $addr = $ua.Address
            if ($addr.AddressFamily -ne 'InterNetwork') { continue }
            $text = $addr.ToString()
            if ($text.StartsWith('169.254.')) { continue }
            $result += [pscustomobject]@{ address = $text; name = $nic.Name; wifi = ($nic.NetworkInterfaceType -eq 'Wireless80211') }
        }
    }
    return ,@($result | Sort-Object @{ Expression = { -not $_.wifi } }, address)
}

# Lauscht auf IPv4 und IPv6 zugleich. Windows loest "localhost" oft zuerst als ::1 auf;
# ein reiner IPv4-Server waere unter localhost dann nicht erreichbar.
function New-KitListener([int]$port) {
    try {
        $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::IPv6Any, $port)
        $l.Server.DualMode = $true
        $l.Start()
        return $l
    } catch {
        $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $port)
        $l.Start()
        return $l
    }
}

# Freien Port suchen
$listener = $null
for ($p = $Port; $p -lt ($Port + 20); $p++) {
    try {
        $listener = New-KitListener $p
        $Port = $p
        break
    } catch {
        continue
    }
}
if (-not $listener) {
    Write-Host "  Kein freier Port zwischen $Port und $($Port + 19)." -ForegroundColor Red
    exit 3
}

$addresses = Get-LanAddresses
$info = [ordered]@{
    port       = $Port
    apkName    = $apk.Name
    apkSize    = $apk.Length
    version    = $config['version']
    releaseUrl = $config['releaseUrl']
    ips        = $addresses
    server     = 'powershell'
}
$infoJson = ($info | ConvertTo-Json -Depth 4 -Compress)

# One adb round trip collects everything the USB view shows. Kept identical in server.py.
$infoCmd = "settings get global device_name; echo ---; getprop ro.product.model; echo ---; " +
    "settings get global bluetooth_on; echo ---; dumpsys battery | grep level; echo ---; " +
    "pm list packages com.freekiosk; echo ---; dumpsys deviceidle whitelist | grep -c com.freekiosk; echo ---; " +
    "settings get secure show_ime_with_hard_keyboard; echo ---; " +
    "dumpsys package com.freekiosk | grep -c 'WRITE_SECURE_SETTINGS: granted=true'; echo ---; " +
    "dumpsys bluetooth_manager | grep -A 20 'Bonded devices'"

Write-Host ''
Write-Host '  inDiKo Kit laeuft.' -ForegroundColor Green
Write-Host "  App:          $($apk.Name)  ($([math]::Round($apk.Length / 1MB, 1)) MB)"
Write-Host "  Oberflaeche:  http://localhost:$Port/"
foreach ($a in $addresses) { Write-Host "  Fuer Tablets: http://$($a.address):$Port/freekiosk.apk   ($($a.name))" }
Write-Host ''
Write-Host '  Dieses Fenster offen lassen, solange Tablets eingerichtet werden.'
Write-Host '  Beenden mit Strg+C.'
Write-Host ''

$handler = {
    param($client, $webDir, $apkPath, $infoJson, $root, $port, $infoCmd)

    $ae = [char]0xE4; $ue = [char]0xFC; $oe = [char]0xF6
    $serialRe = '^[A-Za-z0-9_.:\-]{1,64}$'

    function Send-Response($stream, [int]$code, [string]$status, [string]$type, [byte[]]$body, [long]$length, [bool]$headOnly) {
        $header = "HTTP/1.1 $code $status`r`nContent-Type: $type`r`nContent-Length: $length`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
        $hb = [System.Text.Encoding]::ASCII.GetBytes($header)
        $stream.Write($hb, 0, $hb.Length)
        if (-not $headOnly -and $body) { $stream.Write($body, 0, $body.Length) }
    }
    function Send-Json($stream, [int]$code, $obj, [bool]$headOnly) {
        $status = @{ 200 = 'OK'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 413 = 'Payload Too Large'; 500 = 'Internal Server Error' }[$code]
        $body = [System.Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 6 -Compress))
        Send-Response $stream $code $status 'application/json; charset=utf-8' $body $body.Length $headOnly
    }

    function Find-Adb {
        $candidates = @(
            (Join-Path $root 'adb.exe'),
            (Join-Path $root 'platform-tools\adb.exe')
        )
        $cmd = Get-Command adb -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($cmd) { $candidates += $cmd.Path }
        if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe') }
        if ($env:USERPROFILE) { $candidates += (Join-Path $env:USERPROFILE 'Downloads\platform-tools\adb.exe') }
        foreach ($c in $candidates) { if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) { return $c } }
        return ''
    }

    function Invoke-Adb([string]$exe, [string]$arguments, [int]$timeoutMs) {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $exe
        $psi.Arguments = $arguments
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.CreateNoWindow = $true
        $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
        $proc = [System.Diagnostics.Process]::Start($psi)
        $outTask = $proc.StandardOutput.ReadToEndAsync()
        $errTask = $proc.StandardError.ReadToEndAsync()
        if (-not $proc.WaitForExit($timeoutMs)) {
            try { $proc.Kill() } catch { }
            return @{ code = 124; out = ''; err = 'adb antwortet nicht' }
        }
        $proc.WaitForExit()
        return @{ code = $proc.ExitCode; out = $outTask.Result; err = $errTask.Result }
    }

    function Get-UsbInfo([string]$exe, [string]$serial) {
        $r = Invoke-Adb $exe ("-s $serial shell `"$infoCmd`"") 15000
        $parts = @(($r.out + '') -split '---' | ForEach-Object { $_.Trim() })
        while ($parts.Count -lt 9) { $parts += '' }
        $battery = $null
        if ($parts[3] -match '(\d+)') { $battery = [int]$Matches[1] }
        $btOn = $null
        if ($parts[2] -eq '1') { $btOn = $true } elseif ($parts[2] -eq '0') { $btOn = $false }
        $bonded = @()
        $started = $false
        $seen = @{}
        foreach ($line in ($parts[8] -split "`r?`n")) {
            if ($line -match 'Bonded devices') { $started = $true; continue }
            if (-not $started) { continue }
            $m = [regex]::Match($line, '([0-9A-Fa-fXx]{2}(?::[0-9A-Fa-fXx]{2}){5})\s*(?:\[[^\]]*\]\s*)*(.*)')
            if (-not $m.Success) { break }
            $addr = $m.Groups[1].Value
            if ($seen.ContainsKey($addr)) { continue }
            $seen[$addr] = $true
            $bonded += [pscustomobject]@{ address = $addr; name = $m.Groups[2].Value.Trim() }
        }
        $name = $parts[0]
        if ($name -eq 'null') { $name = '' }
        $count5 = 0; [void][int]::TryParse($parts[5], [ref]$count5)
        $count7 = 0; [void][int]::TryParse($parts[7], [ref]$count7)
        return [pscustomobject]@{
            serial    = $serial
            state     = 'device'
            name      = $name
            model     = $parts[1]
            btOn      = $btOn
            battery   = $battery
            freekiosk = ($parts[4] -match 'package:com\.freekiosk')
            idle      = ($count5 -gt 0)
            ime       = ($parts[6] -eq '1')
            secure    = ($count7 -gt 0)
            bonded    = @($bonded)
        }
    }

    function Get-UsbList {
        $exe = Find-Adb
        $devices = @()
        if ($exe) {
            $r = Invoke-Adb $exe 'devices' 15000
            $lines = @(($r.out + '') -split "`r?`n")
            for ($i = 1; $i -lt $lines.Count; $i++) {
                $cols = $lines[$i].Trim() -split '\s+'
                if ($cols.Count -lt 2 -or $cols[0] -notmatch $serialRe) { continue }
                if ($cols[1] -ne 'device') {
                    $devices += [pscustomobject]@{ serial = $cols[0]; state = $cols[1] }
                    continue
                }
                $devices += Get-UsbInfo $exe $cols[0]
            }
        }
        return [pscustomobject]@{ adb = $exe; devices = @($devices) }
    }

    function Invoke-UsbAction($body) {
        $exe = Find-Adb
        if (-not $exe) { throw [System.ArgumentException]'adb fehlt' }
        $serial = [string]$body.serial
        $action = [string]$body.action
        if ($serial -notmatch $serialRe) { throw [System.ArgumentException]"Ung${ue}ltiges Ger${ae}t" }
        $steps = @()
        switch ($action) {
            'bt_off'   { $steps = @('cmd bluetooth_manager disable') }
            'bt_on'    { $steps = @('cmd bluetooth_manager enable') }
            'keyboard' { $steps = @('settings put secure show_ime_with_hard_keyboard 1') }
            'wake'     { $steps = @('input keyevent 224') }
            'rights'   { $steps = @('appops set com.freekiosk android:get_usage_stats allow; pm grant com.freekiosk android.permission.WRITE_SECURE_SETTINGS; dumpsys deviceidle whitelist +com.freekiosk; settings put secure show_ime_with_hard_keyboard 1') }
            'pin' {
                $pin = [string]$body.pin
                if ($pin -notmatch '^\d{4,6}$') { throw [System.ArgumentException]'PIN: 4 bis 6 Ziffern' }
                $steps = @("input text $pin", 'input keyevent 66')
            }
            default { throw [System.ArgumentException]'Unbekannte Aktion' }
        }
        $output = ''
        foreach ($step in $steps) {
            $r = Invoke-Adb $exe ("-s $serial shell `"$step`"") 20000
            $output += $r.out + $r.err
            if ($r.code -ne 0) {
                $msg = (($r.out + $r.err).Trim() -split "`r?`n" | Select-Object -Last 1)
                if (-not $msg) { $msg = "adb-Fehler $($r.code)" }
                throw $msg
            }
        }
        return [pscustomobject]@{ ok = $true; output = $output.Trim() }
    }

    function Get-PlatformTools {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $id = [guid]::NewGuid().ToString('N')
        $zip = Join-Path $env:TEMP "indiko-pt-$id.zip"
        $tmp = Join-Path $env:TEMP "indiko-pt-$id"
        try {
            (New-Object System.Net.WebClient).DownloadFile('https://dl.google.com/android/repository/platform-tools-latest-windows.zip', $zip)
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $tmp)
            $target = Join-Path $root 'platform-tools'
            if (-not (Test-Path -LiteralPath $target)) { [void](New-Item -ItemType Directory -Path $target) }
            Copy-Item -Path (Join-Path $tmp 'platform-tools\*') -Destination $target -Recurse -Force
        } finally {
            Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
        }
        $exe = Join-Path $root 'platform-tools\adb.exe'
        if (-not (Test-Path -LiteralPath $exe)) { throw 'adb nicht im Paket gefunden' }
        return [pscustomobject]@{ ok = $true; adb = $exe }
    }

    $remote = ''
    try {
        $ra = $client.Client.RemoteEndPoint.Address
        if ($ra.IsIPv4MappedToIPv6) { $ra = $ra.MapToIPv4() }
        $remote = $ra.ToString()
        $isLoopback = [System.Net.IPAddress]::IsLoopback($ra)
        $client.ReceiveTimeout = 15000
        $client.SendTimeout = 120000
        $stream = $client.GetStream()

        # Anfrage bis zur Leerzeile lesen (byteweise, damit ein Body nicht verloren geht)
        $buffer = New-Object byte[] 8192
        $ms = New-Object System.IO.MemoryStream
        $headerEnd = -1
        $text = ''
        while ($headerEnd -lt 0 -and $ms.Length -lt 16384) {
            $n = $stream.Read($buffer, 0, $buffer.Length)
            if ($n -le 0) { break }
            $ms.Write($buffer, 0, $n)
            $text = [System.Text.Encoding]::ASCII.GetString($ms.ToArray())
            $headerEnd = $text.IndexOf("`r`n`r`n")
        }
        if ($headerEnd -lt 0) { return }

        $headLines = $text.Substring(0, $headerEnd) -split "`r`n"
        $parts = $headLines[0].Split(' ')
        if ($parts.Length -lt 2) { return }
        $method = $parts[0]
        $path = [System.Uri]::UnescapeDataString(($parts[1] -split '\?')[0])
        $headOnly = ($method -eq 'HEAD')
        $headers = @{}
        for ($i = 1; $i -lt $headLines.Length; $i++) {
            $c = $headLines[$i].IndexOf(':')
            if ($c -gt 0) { $headers[$headLines[$i].Substring(0, $c).Trim().ToLowerInvariant()] = $headLines[$i].Substring($c + 1).Trim() }
        }

        # USB endpoints: only this computer, only under a loopback host name (no DNS rebinding)
        $allowedHosts = @("localhost:$port", "127.0.0.1:$port", "[::1]:$port")
        $localOk = $isLoopback -and ($allowedHosts -contains ([string]$headers['host']).ToLowerInvariant())
        if ($localOk -and $headers['origin']) {
            $o = ([string]$headers['origin']).ToLowerInvariant() -replace '^[a-z]+://', ''
            if ($allowedHosts -notcontains $o) { $localOk = $false }
        }

        if ($method -eq 'POST') {
            if ($path -ne '/api/usb/run' -and $path -ne '/api/usb/adb') {
                Send-Json $stream 404 @{ error = 'Nicht gefunden' } $false
                return
            }
            if (-not $localOk -or $headers['x-kit'] -ne '1') {
                Send-Json $stream 403 @{ error = 'Nur an diesem Laptop' } $false
                return
            }
            $length = 0
            [void][int]::TryParse([string]$headers['content-length'], [ref]$length)
            if ($length -gt 4096) {
                Send-Json $stream 413 @{ error = "Zu gro$([char]0xDF)" } $false
                return
            }
            $all = $ms.ToArray()
            $bodyBytes = New-Object System.IO.MemoryStream
            $start = $headerEnd + 4
            if ($all.Length -gt $start) { $bodyBytes.Write($all, $start, $all.Length - $start) }
            while ($bodyBytes.Length -lt $length) {
                $n = $stream.Read($buffer, 0, [math]::Min($buffer.Length, $length - $bodyBytes.Length))
                if ($n -le 0) { break }
                $bodyBytes.Write($buffer, 0, $n)
            }
            $bodyText = [System.Text.Encoding]::UTF8.GetString($bodyBytes.ToArray())
            try {
                $body = if ($bodyText.Trim()) { $bodyText | ConvertFrom-Json } else { [pscustomobject]@{} }
                if ($path -eq '/api/usb/run') { $result = Invoke-UsbAction $body } else { $result = Get-PlatformTools }
                Send-Json $stream 200 $result $false
            } catch [System.ArgumentException] {
                Send-Json $stream 400 @{ error = $_.Exception.Message } $false
            } catch {
                Send-Json $stream 500 @{ error = $_.Exception.Message } $false
            }
            return
        }

        if ($method -ne 'GET' -and $method -ne 'HEAD') {
            $msg = [System.Text.Encoding]::UTF8.GetBytes('Method not allowed')
            Send-Response $stream 405 'Method Not Allowed' 'text/plain; charset=utf-8' $msg $msg.Length $headOnly
            return
        }

        if ($path -eq '/api/info') {
            $body = [System.Text.Encoding]::UTF8.GetBytes($infoJson)
            Send-Response $stream 200 'OK' 'application/json; charset=utf-8' $body $body.Length $headOnly
            return
        }

        if ($path -eq '/api/usb') {
            if (-not $localOk) { Send-Json $stream 403 @{ error = 'Nur an diesem Laptop' } $headOnly; return }
            try { Send-Json $stream 200 (Get-UsbList) $headOnly } catch { Send-Json $stream 500 @{ error = $_.Exception.Message } $headOnly }
            return
        }

        if ($path -eq '/freekiosk.apk') {
            $file = New-Object System.IO.FileInfo($apkPath)
            Send-Response $stream 200 'OK' 'application/vnd.android.package-archive' $null $file.Length $headOnly
            if (-not $headOnly) {
                $fs = [System.IO.File]::OpenRead($apkPath)
                try { $fs.CopyTo($stream, 65536) } finally { $fs.Dispose() }
                if (-not $isLoopback) {
                    [Console]::WriteLine(('  {0}  {1} hat die App geladen' -f [DateTime]::Now.ToString('HH:mm:ss'), $remote))
                }
            }
            return
        }

        if ($path -eq '/') { $path = '/index.html' }
        $relative = $path.TrimStart('/').Replace('/', '\')
        $full = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($webDir, $relative))
        $webRoot = [System.IO.Path]::GetFullPath($webDir)
        if (-not $full.StartsWith($webRoot, [System.StringComparison]::OrdinalIgnoreCase) -or -not [System.IO.File]::Exists($full)) {
            $msg = [System.Text.Encoding]::UTF8.GetBytes('Nicht gefunden')
            Send-Response $stream 404 'Not Found' 'text/plain; charset=utf-8' $msg $msg.Length $headOnly
            return
        }

        $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
        $type = 'application/octet-stream'
        if ($ext -eq '.html') { $type = 'text/html; charset=utf-8' }
        elseif ($ext -eq '.js') { $type = 'text/javascript; charset=utf-8' }
        elseif ($ext -eq '.css') { $type = 'text/css; charset=utf-8' }
        elseif ($ext -eq '.json') { $type = 'application/json; charset=utf-8' }
        elseif ($ext -eq '.svg') { $type = 'image/svg+xml' }
        elseif ($ext -eq '.png') { $type = 'image/png' }
        $bytes = [System.IO.File]::ReadAllBytes($full)
        Send-Response $stream 200 'OK' $type $bytes $bytes.Length $headOnly
    } catch {
        if ($remote -and -not $isLoopback) {
            [Console]::WriteLine(('  {0}  Verbindung zu {1} abgebrochen: {2}' -f [DateTime]::Now.ToString('HH:mm:ss'), $remote, $_.Exception.Message))
        }
    } finally {
        $client.Close()
    }
}

$pool = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspacePool(1, 16)
$pool.Open()
$jobs = New-Object System.Collections.ArrayList

if (-not $NoBrowser) { Start-Process "http://localhost:$Port/" }

try {
    while ($true) {
        if (-not $listener.Pending()) {
            Start-Sleep -Milliseconds 50
            foreach ($job in @($jobs)) {
                if ($job.Handle.IsCompleted) {
                    try { [void]$job.PowerShell.EndInvoke($job.Handle) } catch { }
                    $job.PowerShell.Dispose()
                    $jobs.Remove($job)
                }
            }
            continue
        }
        $client = $listener.AcceptTcpClient()
        $ps = [PowerShell]::Create()
        $ps.RunspacePool = $pool
        [void]$ps.AddScript($handler).AddArgument($client).AddArgument($webDir).AddArgument($apk.FullName).AddArgument($infoJson).AddArgument($root).AddArgument($Port).AddArgument($infoCmd)
        $handle = $ps.BeginInvoke()
        [void]$jobs.Add([pscustomobject]@{ PowerShell = $ps; Handle = $handle })

        foreach ($job in @($jobs)) {
            if ($job.Handle.IsCompleted) {
                try { [void]$job.PowerShell.EndInvoke($job.Handle) } catch { }
                $job.PowerShell.Dispose()
                $jobs.Remove($job)
            }
        }
    }
} finally {
    $listener.Stop()
    $pool.Close()
}
