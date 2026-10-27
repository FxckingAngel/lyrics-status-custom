$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$appPath = Join-Path $root "LyricsStatus.exe"
$configPath = Join-Path $root "launcher.json"
$downloadPath = Join-Path $root "LyricsStatus.download.exe"
$backupPath = Join-Path $root "LyricsStatus.previous.exe"

function Read-LauncherConfig {
    if (-not (Test-Path -LiteralPath $configPath)) {
        return [pscustomobject]@{
            manifestUrl = "https://github.com/OvalQuilter/lyrics-status/releases/latest/download/latest.json"
            pollSeconds = 60
        }
    }

    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($config.manifestUrl)) { throw "launcher.json must contain manifestUrl" }
    $pollSeconds = [Math]::Max(30, [int]$config.pollSeconds)
    return [pscustomobject]@{ manifestUrl = $config.manifestUrl; pollSeconds = $pollSeconds }
}

function Get-Version {
    $versionPath = Join-Path $root "VERSION"
    if (-not (Test-Path -LiteralPath $versionPath)) { return [version]"0.0.0" }
    try { return [version](Get-Content -LiteralPath $versionPath -Raw).Trim() } catch { return [version]"0.0.0" }
}

function Get-Manifest($url) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 15
        $manifest = $response.Content | ConvertFrom-Json
        if ([string]::IsNullOrWhiteSpace($manifest.version) -or [string]::IsNullOrWhiteSpace($manifest.url) -or [string]::IsNullOrWhiteSpace($manifest.sha256)) { return $null }
        return $manifest
    } catch {
        return $null
    }
}

function Install-Update($manifest, [version]$currentVersion) {
    try {
        $remoteVersion = [version]$manifest.version
        if ($remoteVersion -le $currentVersion) { return $false }

        Invoke-WebRequest -UseBasicParsing -Uri $manifest.url -OutFile $downloadPath -TimeoutSec 120
        $actualHash = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualHash -ne $manifest.sha256.ToLowerInvariant()) { throw "Downloaded update hash did not match the manifest" }

        if (Test-Path -LiteralPath $backupPath) { Remove-Item -LiteralPath $backupPath -Force }
        Move-Item -LiteralPath $appPath -Destination $backupPath -Force
        try {
            Move-Item -LiteralPath $downloadPath -Destination $appPath -Force
        } catch {
            Move-Item -LiteralPath $backupPath -Destination $appPath -Force
            throw
        }
        return $true
    } catch {
        if (Test-Path -LiteralPath $downloadPath) { Remove-Item -LiteralPath $downloadPath -Force -ErrorAction SilentlyContinue }
        return $false
    }
}

$config = Read-LauncherConfig
$currentVersion = Get-Version

while ($true) {
    $manifest = Get-Manifest $config.manifestUrl
    if ($manifest -and (Install-Update $manifest $currentVersion)) {
        $currentVersion = [version]$manifest.version
    }

    $process = Start-Process -FilePath $appPath -WorkingDirectory $root -PassThru
    while (-not $process.HasExited) {
        Start-Sleep -Seconds $config.pollSeconds
        $manifest = Get-Manifest $config.manifestUrl
        if ($manifest -and ([version]$manifest.version -gt $currentVersion)) {
            $process.CloseMainWindow() | Out-Null
            Start-Sleep -Seconds 3
            if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
            if (Install-Update $manifest $currentVersion) { $currentVersion = [version]$manifest.version }
            break
        }
    }

    if ($process.HasExited) { Start-Sleep -Seconds 2 }
}
