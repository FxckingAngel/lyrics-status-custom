import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { spawn, ChildProcess } from "node:child_process"
import { tmpdir } from "node:os"
import { Debug } from "./Debug"

const trayScript = String.raw`
$ErrorActionPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$base = "http://127.0.0.1:8999"
$iconPath = Join-Path $env:TEMP "lyrics-status-tray-$PID.ico"
try { [IO.File]::WriteAllBytes($iconPath, [Convert]::FromBase64String("__ICON_DATA__")) } catch {}
$icon = New-Object System.Windows.Forms.NotifyIcon
if (Test-Path -LiteralPath $iconPath) { $icon.Icon = New-Object System.Drawing.Icon($iconPath) } else { $icon.Icon = [System.Drawing.SystemIcons]::Application }
$icon.Text = "LyricsStatus"
$icon.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add("Open settings")
$quit = $menu.Items.Add("Quit LyricsStatus")
$open.Add_Click({ Start-Process "$base/" })
$quit.Add_Click({
  try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$base/api/quit" -TimeoutSec 2 | Out-Null } catch {}
  $icon.Visible = $false
  [System.Windows.Forms.Application]::ExitThread()
})
$icon.ContextMenuStrip = $menu
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({
  try { Invoke-WebRequest -UseBasicParsing -Uri "$base/api/status" -TimeoutSec 1 | Out-Null }
  catch { $timer.Stop(); $icon.Visible = $false; [System.Windows.Forms.Application]::ExitThread() }
})
$timer.Start()
[System.Windows.Forms.Application]::Run()
$timer.Dispose()
$icon.Dispose()
try { Remove-Item -LiteralPath $PSCommandPath -Force } catch {}
try { Remove-Item -LiteralPath $iconPath -Force } catch {}
`

let trayProcess: ChildProcess | null = null
let trayScriptPath: string | null = null

export function startTray(): void {
    if (process.platform !== "win32" || trayProcess) return

    trayScriptPath = join(tmpdir(), `lyrics-status-tray-${process.pid}.ps1`)
    try {
        const iconPath = existsSync(join(__dirname, "../res/logo.ico"))
            ? join(__dirname, "../res/logo.ico")
            : join(dirname(process.execPath), "res/logo.ico")
        const iconData = existsSync(iconPath) ? readFileSync(iconPath).toString("base64") : ""
        writeFileSync(trayScriptPath, trayScript.replace("__ICON_DATA__", iconData), "utf8")
        const commandShell = process.env.ComSpec || "cmd.exe"
        trayProcess = spawn(commandShell, [
            "/c",
            "start",
            "",
            "powershell.exe",
            "-NoLogo",
            "-NoProfile",
            "-STA",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-File",
            trayScriptPath
        ], { detached: true, stdio: "ignore", windowsHide: true })
        trayProcess.unref()
        trayProcess.on("error", (error) => Debug.write(`Tray failed to start: ${error.message}`))
    } catch (error) {
        Debug.write(`Tray setup failed: ${(error as Error).message}`)
    }
}

export function cleanUpTrayScript(): void {
    if (!trayScriptPath || !existsSync(trayScriptPath)) return
    try { unlinkSync(trayScriptPath) } catch {}
}
