import { LyricsFetcher } from "./LyricsFetcher"
import { SpotifySource} from "./Sources/SpotifySource"
import { NetEaseMusicSource } from "./Sources/NetEaseMusicSource"
import { LrcLibSource } from "./Sources/LrcLibSource"
import { QQMusicSource } from "./Sources/QQMusicSource"
import { PlaybackStateUpdater } from "./PlaybackStateUpdater"
import { PlaybackState } from "./PlaybackState"
import { StatusChanger } from "./StatusChanger"
import { Debug } from "./Debug"
import { startServer } from "./Panel/Server"
import { Settings } from "./Settings"
import { SpotifyService } from "./SpotifyService"
import { v4 as uuidv4 } from "uuid"
import { ExternalAuthServerAPI } from "./ExternalAuthServerAPI"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { spawn } from "node:child_process"
import { startTray, cleanUpTrayScript } from "./Tray"
import { updatePackagedExecutable } from "./PackagedUpdater"
import { sanitizeStatusText } from "./ContentFilter"
import { showDesktopUpdateNotification } from "./Notifications"

function hideWindowsConsole(): void {
    if (process.platform !== "win32") return
    try {
        const consoleWindow = require("node-hide-console-window") as { hideConsole: () => void }
        consoleWindow.hideConsole()
    } catch (error) {
        Debug.write(`Console hiding unavailable: ${(error as Error).message}`)
    }
}

hideWindowsConsole()

const isPackaged = Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg)

function handOffToUpdater(): boolean {
    if (!isPackaged || process.env.LYRICS_STATUS_LAUNCHER === "1") return false

    const launcherPath = join(dirname(process.execPath), "LyricsStatusLauncher.ps1")
    if (!existsSync(launcherPath)) return false

    const environment = { ...process.env, LYRICS_STATUS_LAUNCHER: "1" }
    const commandShell = process.env.ComSpec || "cmd.exe"
    const child = spawn(commandShell, [
        "/c",
        "start",
        "",
        "powershell.exe",
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-File",
        launcherPath
    ], {
        cwd: dirname(process.execPath),
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: environment
    })
    child.on("error", (error) => {
        console.error("Could not start the LyricsStatus updater:", error.message)
    })
    child.unref()
    return true
}

if (handOffToUpdater()) process.exit(0)

Settings.load()

if (Settings.update.enableAutoupdate && isPackaged) {
    updatePackagedExecutable().then(() => init())
        .catch((error) => {
            Debug.write("LyricsStatus packaged update check failed: " + (error as Error).stack)
            init()
        })
} else {
    init()
}

function init(): void {
    startTray()
    const updateVersion = process.env.LYRICS_STATUS_UPDATE_VERSION
    if (updateVersion) {
        showDesktopUpdateNotification(updateVersion)
        delete process.env.LYRICS_STATUS_UPDATE_VERSION
    }
    process.once("exit", cleanUpTrayScript)
    if (!Settings.credentials.uuid) {
        Settings.credentials.uuid = uuidv4()

        Settings.save()
    }
    void ExternalAuthServerAPI.register().catch((error) => {
        Debug.write("External auth registration failed: " + (error as Error).message)
    })

    void SpotifyService.refresh().catch((error) => {
        Debug.write("Spotify token refresh failed: " + (error as Error).message)
    })

    const lyricsFetcher = new LyricsFetcher()
    lyricsFetcher.addSource(new LrcLibSource())
    lyricsFetcher.addSource(new SpotifySource())
    lyricsFetcher.addSource(new NetEaseMusicSource())
    lyricsFetcher.addSource(new QQMusicSource())

    const playbackState = new PlaybackState()
    const playbackStateUpdater = new PlaybackStateUpdater(playbackState, lyricsFetcher)

    const statusChanger = new StatusChanger(playbackState)

    let updateInFlight = false
    setInterval(() => {
        if (updateInFlight) return
        updateInFlight = true
        playbackStateUpdater.update().finally(() => {
            updateInFlight = false
        }).catch((error) => {
            Debug.write("Playback update failed: " + (error as Error).message)
        })

        //console.log(playbackState)
        //console.log(statusChanger, playbackStateUpdater, SpotifyAccessToken)
    }, 3000)

    let now = Date.now()
    let lastConsoleUpdate = 0
    setInterval(() => {
        statusChanger.changeStatus()

        if (playbackState.isPlaying) playbackState.songProgress += Date.now() - now

        if (playbackState.ended) statusChanger.songChanged()

        if (Date.now() - lastConsoleUpdate >= 1000) {
            console.clear()
            console.log(`
    Song: ${playbackState.songName || "Not listening"}
    Author: ${playbackState.songAuthor || "Not listening"}
    Song progress: ${statusChanger.formatSeconds(+(playbackState.songProgress / 1000).toFixed(0))}
    Current lyrics: ${(playbackState.currentLine && playbackState.currentLine.text) || "Not available"}
    Lyrics fetched from: ${lyricsFetcher.lastFetchedFrom}
    `)
            lastConsoleUpdate = Date.now()
        }

        now = Date.now()
    }, 100)

    startServer(() => ({
        running: true,
        song: playbackState.songName || "Not listening",
        author: playbackState.songAuthor,
        progress: statusChanger.formatSeconds(+(playbackState.songProgress / 1000).toFixed(0)),
        isPlaying: playbackState.isPlaying,
        currentLyric: playbackState.currentLine ? sanitizeStatusText(playbackState.currentLine.text) : "Not available",
        lyricsSource: lyricsFetcher.lastFetchedFrom,
        statusResult: statusChanger.lastStatusResult,
        lastStatusUpdateAt: statusChanger.lastStatusUpdateAt,
        rateLimitRemaining: statusChanger.rateLimitRemaining,
        rateLimitLimit: statusChanger.rateLimitLimit,
        rateLimitResetAt: statusChanger.rateLimitResetAt,
        rateLimitScope: statusChanger.rateLimitScope,
        rateLimitBucket: statusChanger.rateLimitBucket,
        rateLimitGlobal: statusChanger.rateLimitGlobal
    }))
}

process.on("uncaughtException", (e) => {
    Debug.write(e.stack + "\n" + e.cause)

    if (!e.message.includes("fetch failed")) {
        process.exit(1)
    }
})

process.on("unhandledRejection", (reason) => {
    Debug.write("Unhandled promise rejection: " + String(reason))
})
