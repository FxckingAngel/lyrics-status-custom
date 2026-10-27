import { Debug } from "./Debug"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

type WindowsToaster = new (options: { withFallback: boolean, customPath?: string }) => {
    notify: (options: { title: string, message: string, appID: string }, callback?: (error?: Error) => void) => void
}

function getBundledSnoreToastPath(): string {
    const bundledPath = join(__dirname, "../res/snoretoast-x64.exe")
    const extractedPath = join(tmpdir(), `lyrics-status-snoretoast-${process.pid}.exe`)

    if (!existsSync(extractedPath)) {
        writeFileSync(extractedPath, readFileSync(bundledPath))
    }

    return extractedPath
}

export function showDesktopUpdateNotification(version: string): void {
    if (process.platform !== "win32") return

    try {
        const notifier = require("node-notifier") as { WindowsToaster: WindowsToaster }
        const toaster = new notifier.WindowsToaster({
            withFallback: false,
            customPath: getBundledSnoreToastPath()
        })
        toaster.notify({
            title: "LyricsStatus",
            message: `Update v${version} is installing. Your settings will stay in place.`,
            appID: "LyricsStatus"
        }, (error) => {
            if (error) Debug.write(`Desktop notification failed: ${error.message}`)
        })
    } catch (error) {
        Debug.write(`Desktop notification unavailable: ${(error as Error).message}`)
    }
}
