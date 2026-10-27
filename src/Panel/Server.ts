import express from "express"
import { createServer } from "node:http"
import { WebSocketServer } from "ws"
import { join, dirname } from "node:path"
import { readFileSync } from "node:fs"
import { Settings } from "../Settings"
import { SpotifyService } from "../SpotifyService"
import { spawn } from "node:child_process"

type RuntimeStatus = () => object

export function startServer(runtimeStatus?: RuntimeStatus): void {
    const app = express()
    const httpServer = createServer(app)
    const wss = new WebSocketServer({
        server: httpServer,
        path: "/ws",
        maxPayload: 64 * 1024
    })

    const staticDirectory = isPackaged() ? join(process.cwd(), "static") : join(__dirname, "../../static")
    app.use("/", express.static(staticDirectory))

    app.get("/", (req, res) => {
        res.sendFile(join(staticDirectory, "index.html"))
    })

    app.get("/api/status", (req, res) => {
        res.json({
            version: getVersion(),
            settingsFile: "settings.json",
            ...(runtimeStatus ? runtimeStatus() : { running: true })
        })
    })

    app.get("/callback", async (req, res) => {
        if (Settings.credentials.useExternalAuthServer) {
            if (!req.query.refresh_token) return res.sendStatus(401)

            const refreshToken = req.query.refresh_token
            Settings.credentials.refreshToken = refreshToken as string
            Settings.save()
            return res.send("Spotify connected. You can close this page now.")
        } else {
            if (!req.query.code) return res.sendStatus(401)

            const code = req.query.code
            Settings.credentials.code = code as string
            try {
                await SpotifyService.exchange()
                Settings.save()
                return res.send("Spotify connected. You can close this page now.")
            } catch (error) {
                console.error("Spotify authorization failed:", (error as Error).message)
                return res.status(500).send("Spotify authorization failed. Check the app log for details.")
            }
        }
    })

    wss.on("connection", (ws) => {
        ws.on("message", (data) => {
            try {
                Settings.apply(JSON.parse(data.toString()))
                Settings.save()
                ws.send(JSON.stringify(getSettings()))
            } catch (error) {
                console.error("Could not save settings:", error)
            }
        })

        ws.on("error", (error) => console.error("Settings panel connection error:", error.message))

        ws.send(JSON.stringify(getSettings()))
    })

    httpServer.on("error", (error) => {
        console.error("LyricsStatus panel failed to start:", error.message)
        if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
            openPanel()
            process.exitCode = 1
        }
    })

    httpServer.once("listening", openPanel)
    httpServer.listen(8999, "127.0.0.1")
}

function isPackaged(): boolean {
    return Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg)
}

function getVersion(): string {
    const versionPath = isPackaged()
        ? join(dirname(process.execPath), "VERSION")
        : join(__dirname, "../../VERSION")

    try {
        return readFileSync(versionPath, "utf8").trim()
    } catch {
        return "unknown"
    }
}

function openPanel(): void {
    if (process.platform !== "win32") return

    const commandShell = process.env.ComSpec || "cmd.exe"
    const child = spawn(commandShell, ["/c", "start", "", "http://127.0.0.1:8999/"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true
    })
    child.unref()
}

function getSettings(): object {
    return {
            credentials: Settings.credentials,
            view: Settings.view,
            timings: Settings.timings,
            update: Settings.update
        }
}
