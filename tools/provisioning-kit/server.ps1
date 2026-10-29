# FreeKiosk QR-Kit - kleiner Webserver fuer Windows (PowerShell 5.1 und neuer).
# Liefert die Oberflaeche (web\) und die FreeKiosk-APK an Browser und Tablets aus.
# Braucht keine Installation und keine Adminrechte; die Windows-Firewall fragt beim
# ersten Start einmal nach, ob Tablets im Netzwerk zugreifen duerfen.

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

Write-Host ''
Write-Host '  FreeKiosk QR-Kit laeuft.' -ForegroundColor Green
Write-Host "  App:        $($apk.Name)  ($([math]::Round($apk.Length / 1MB, 1)) MB)"
Write-Host "  Oberflaeche: http://localhost:$Port/"
foreach ($a in $addresses) { Write-Host "  Fuer Tablets: http://$($a.address):$Port/freekiosk.apk   ($($a.name))" }
Write-Host ''
Write-Host '  Dieses Fenster offen lassen, solange Tablets eingerichtet werden.'
Write-Host '  Beenden mit Strg+C.'
Write-Host ''

$handler = {
    param($client, $webDir, $apkPath, $infoJson)

    function Send-Response($stream, [int]$code, [string]$status, [string]$type, [byte[]]$body, [long]$length, [bool]$headOnly) {
        $header = "HTTP/1.1 $code $status`r`nContent-Type: $type`r`nContent-Length: $length`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
        $hb = [System.Text.Encoding]::ASCII.GetBytes($header)
        $stream.Write($hb, 0, $hb.Length)
        if (-not $headOnly -and $body) { $stream.Write($body, 0, $body.Length) }
    }

    $remote = ''
    try {
        $ra = $client.Client.RemoteEndPoint.Address
        if ($ra.IsIPv4MappedToIPv6) { $ra = $ra.MapToIPv4() }
        $remote = $ra.ToString()
        $client.ReceiveTimeout = 15000
        $client.SendTimeout = 120000
        $stream = $client.GetStream()

        # Anfrage bis zur Leerzeile lesen
        $buffer = New-Object byte[] 8192
        $requestText = ''
        while ($requestText.IndexOf("`r`n`r`n") -lt 0 -and $requestText.Length -lt 16384) {
            $n = $stream.Read($buffer, 0, $buffer.Length)
            if ($n -le 0) { break }
            $requestText += [System.Text.Encoding]::ASCII.GetString($buffer, 0, $n)
        }
        if (-not $requestText) { return }

        $firstLine = ($requestText -split "`r`n")[0]
        $parts = $firstLine.Split(' ')
        if ($parts.Length -lt 2) { return }
        $method = $parts[0]
        $path = [System.Uri]::UnescapeDataString(($parts[1] -split '\?')[0])
        $headOnly = ($method -eq 'HEAD')

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

        if ($path -eq '/freekiosk.apk') {
            $file = New-Object System.IO.FileInfo($apkPath)
            Send-Response $stream 200 'OK' 'application/vnd.android.package-archive' $null $file.Length $headOnly
            if (-not $headOnly) {
                $fs = [System.IO.File]::OpenRead($apkPath)
                try { $fs.CopyTo($stream, 65536) } finally { $fs.Dispose() }
                if ($remote -ne '127.0.0.1' -and $remote -ne '::1') {
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
        if ($remote -and $remote -ne '127.0.0.1' -and $remote -ne '::1') {
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
        [void]$ps.AddScript($handler).AddArgument($client).AddArgument($webDir).AddArgument($apk.FullName).AddArgument($infoJson)
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
