import { createHash } from "node:crypto"
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawn } from "node:child_process"
import { fetchWithTimeout } from "./Http"
import { Debug } from "./Debug"

const manifestUrl = "https://github.com/FxckingAngel/lyrics-status-custom/releases/latest/download/latest.json"
const compiledVersion = "3.0.21"

function isPackaged(): boolean {
    return Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg)
}

function readVersion(): string {
    const candidates = [join(dirname(process.execPath), "VERSION"), join(__dirname, "../VERSION")]
    for (const path of candidates) {
        try { return readFileSync(path, "utf8").trim() } catch {}
    }
    return compiledVersion
}

function quotePowerShell(value: string): string {
    return `'${value.replace(/'/g, "''")}'`
}

function newer(remote: string, local: string): boolean {
    const a = remote.replace(/^v/i, "").split(".").map(Number)
    const b = local.replace(/^v/i, "").split(".").map(Number)
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0)
    }
    return false
}

export async function updatePackagedExecutable(): Promise<void> {
    if (!isPackaged()) return

    try {
        const cacheBust = `update=${Date.now()}`
        const response = await fetchWithTimeout(`${manifestUrl}?${cacheBust}`, { headers: { Accept: "application/json" } }, 8000)
        if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`)
        const manifest = await response.json() as { version?: string; url?: string; sha256?: string }
        if (!manifest.version || !manifest.url || !manifest.sha256 || !newer(manifest.version, readVersion())) return

        const downloadPath = join(tmpdir(), `LyricsStatus-${process.pid}.download.exe`)
        const downloadUrl = `${manifest.url}${manifest.url.includes("?") ? "&" : "?"}${cacheBust}`
        const download = await fetchWithTimeout(downloadUrl, {}, 30000)
        if (!download.ok) throw new Error(`Executable download failed: ${download.status}`)
        const bytes = Buffer.from(await download.arrayBuffer())
        const actualHash = createHash("sha256").update(bytes).digest("hex").toLowerCase()
        if (actualHash !== manifest.sha256.toLowerCase()) throw new Error("Downloaded executable hash did not match the release manifest")
        writeFileSync(downloadPath, bytes)

        const currentPath = process.execPath
        const backupPath = `${currentPath}.previous.exe`
        const scriptPath = join(tmpdir(), `LyricsStatus-update-${process.pid}.ps1`)
        const script = [
            "$ErrorActionPreference = 'SilentlyContinue'",
            `$current = ${quotePowerShell(currentPath)}`,
            `$download = ${quotePowerShell(downloadPath)}`,
            `$backup = ${quotePowerShell(backupPath)}`,
            `$processId = ${process.pid}`,
            "while (Get-Process -Id $processId -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 200 }",
            "if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }",
            "Move-Item -LiteralPath $current -Destination $backup -Force",
            "Move-Item -LiteralPath $download -Destination $current -Force",
            "$env:LYRICS_STATUS_LAUNCHER = '1'",
            "Start-Process -FilePath $current -WorkingDirectory (Split-Path -Parent $current) -WindowStyle Hidden -PassThru | Out-Null",
            "Remove-Item -LiteralPath $backup -Force",
            "Remove-Item -LiteralPath $PSCommandPath -Force"
        ].join("\r\n")
        writeFileSync(scriptPath, script, "utf8")

        const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", scriptPath], {
            cwd: dirname(currentPath), detached: true, stdio: "ignore", windowsHide: true
        })
        child.unref()
        process.exit(0)
    } catch (error) {
        Debug.write(`Packaged update skipped: ${(error as Error).message}`)
    }
}
