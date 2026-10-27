import { PlaybackState } from "./PlaybackState"
import { Settings } from "./Settings"
import { LyricsLine } from "./Sources/BaseSource"
import { Autooffset } from "./Autooffset"
import { Debug } from "./Debug"
import { fetchWithTimeout } from "./Http"
import { containsBlockedSlur, sanitizeStatusText } from "./ContentFilter"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

type PendingStatus = { text: string, emoji: string }
type RateLimitState = { nextStatusAt: number, backoff: number, strikes: number, global?: boolean }

export class StatusChanger {
    public playbackState: PlaybackState
    public sentLines: LyricsLine[]
    public autooffset: Autooffset
    public lastStatusUpdateAt: number
    public lastStatusResult: string
    public rateLimitRemaining: number | null
    public rateLimitLimit: number | null
    public rateLimitResetAt: number
    public rateLimitScope: string
    public rateLimitBucket: string
    public rateLimitGlobal: boolean

    private pendingStatus: PendingStatus | null
    private sendingStatus: boolean
    private nextStatusAt: number
    private lastQueuedLineTime: number | null
    private lastSongId: string
    private rateLimitBackoff: number
    private rateLimitStrikes: number
    private readonly rateLimitStatePath = "./rate-limit-state.json"

    constructor(playbackState: PlaybackState) {
        this.playbackState = playbackState
        this.sentLines = []
        this.autooffset = new Autooffset()
        this.lastStatusUpdateAt = 0
        this.lastStatusResult = "Not sent"
        this.rateLimitRemaining = null
        this.rateLimitLimit = null
        this.rateLimitResetAt = 0
        this.rateLimitScope = ""
        this.rateLimitBucket = ""
        this.rateLimitGlobal = false
        this.pendingStatus = null
        this.sendingStatus = false
        this.nextStatusAt = 0
        this.lastQueuedLineTime = null
        this.lastSongId = ""
        this.rateLimitBackoff = 0
        this.rateLimitStrikes = 0
        this.loadRateLimitState()
    }

    public changeStatusRequest(text: string, token: string, emoji: string): Promise<Response> {
        const parsedEmoji = this.parseEmoji(emoji)

        return fetchWithTimeout("https://discordapp.com/api/v8/users/@me/settings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "Authorization": token },
            body: JSON.stringify({
                custom_status: {
                    text,
                    emoji_id: parsedEmoji.id,
                    emoji_name: parsedEmoji.name,
                    expires_at: new Date(Date.now() + 60000).toISOString()
                }
            })
        })
    }

    public changeStatus(): void {
        this.autooffset.setLimit(Settings.timings.autooffset)

        const playbackState = this.playbackState
        if (playbackState.songId !== this.lastSongId) {
            this.songChanged()
            this.lastSongId = playbackState.songId
        }
        if (playbackState.ended || !playbackState.hasLyrics || !playbackState.isPlaying) {
            return
        }

        this.flushPendingStatus()

        const lyrics = playbackState.lyrics
        if (!lyrics) return

        const songProgress = playbackState.songProgress
        const offset = Settings.timings.enableAutooffset
            ? this.autooffset.getAverageValue() + 100
            : Settings.timings.sendTimeOffset

        for (let i = 0; i < lyrics.lines.length; i++) {
            const line = lyrics.lines[i]
            const nextLine = lyrics.lines[i + 1]
            if (line.time >= songProgress + offset) continue
            if (!line.text || (nextLine && nextLine.time < songProgress + offset)) continue
            if (line.time === this.lastQueuedLineTime) break

            playbackState.currentLine = line
            const rawText = Settings.view.advanced.enabled
                ? this.parseStatusString(Settings.view.advanced.customStatus)
                : this.getStatusString(line)
            const text = sanitizeStatusText(rawText)

            this.lastQueuedLineTime = line.time
            this.pendingStatus = { text, emoji: Settings.view.advanced.customEmoji }
            if (!this.lastStatusResult.startsWith("Rate limited")) {
                this.lastStatusResult = `Queued lyric at ${line.time}ms`
            }
            break
        }
    }

    public songChanged(): void {
        this.sentLines = []
        this.pendingStatus = null
        this.lastQueuedLineTime = null
    }

    private flushPendingStatus(): void {
        if (!this.pendingStatus || this.sendingStatus || Date.now() < this.nextStatusAt) return

        const update = this.pendingStatus
        this.pendingStatus = null
        this.sendingStatus = true
        const startedAt = Date.now()

        this.changeStatusRequest(update.text, Settings.credentials.token, update.emoji)
            .then((response) => {
                this.sendingStatus = false
                if (response.ok) {
                    this.lastStatusUpdateAt = Date.now()
                    this.lastStatusResult = "Updated"
                    this.autooffset.addValue(Date.now() - startedAt)
                    this.captureRateLimitHeaders(response)
                    this.rateLimitStrikes = 0
                    this.rateLimitBackoff = 0
                    this.saveRateLimitState()
                    this.nextStatusAt = Date.now() + this.getNextStatusDelay(response)
                    return
                }

                if (response.status === 429) {
                    void this.handleRateLimit(response, update)
                    return
                }

                Debug.write(`Discord status update returned ${response.status}.`)
                this.lastStatusResult = `Discord returned ${response.status}`
                this.nextStatusAt = Date.now() + 3000
            })
            .catch((error) => {
                this.sendingStatus = false
                this.pendingStatus = update
                this.nextStatusAt = Date.now() + 3000
                this.lastStatusResult = "Request failed; retrying"
                Debug.write("Discord status update failed: " + (error as Error).message)
            })
    }

    private getStatusInterval(): number {
        return Math.max(800, Math.min(5000, Settings.timings.statusUpdateInterval))
    }

    private getNextStatusDelay(response: Response): number {
        this.captureRateLimitHeaders(response)
        const remaining = Number(response.headers.get("x-ratelimit-remaining"))
        const resetAfter = Number(response.headers.get("x-ratelimit-reset-after"))

        if (remaining <= 1 && Number.isFinite(resetAfter)) return Math.max(this.getStatusInterval(), this.rateLimitBackoff, resetAfter * 1000)
        return Math.max(this.getStatusInterval(), this.rateLimitBackoff)
    }

    private captureRateLimitHeaders(response: Response): void {
        const remaining = Number(response.headers.get("x-ratelimit-remaining"))
        const limit = Number(response.headers.get("x-ratelimit-limit"))
        const resetAfter = Number(response.headers.get("x-ratelimit-reset-after"))
        const scope = response.headers.get("x-ratelimit-scope")
        const bucket = response.headers.get("x-ratelimit-bucket")

        this.rateLimitRemaining = Number.isFinite(remaining) ? remaining : null
        this.rateLimitLimit = Number.isFinite(limit) ? limit : null
        this.rateLimitResetAt = Number.isFinite(resetAfter) ? Date.now() + resetAfter * 1000 : 0
        if (scope) this.rateLimitScope = scope
        if (bucket) this.rateLimitBucket = bucket
    }

    private async handleRateLimit(response: Response, update: PendingStatus): Promise<void> {
        this.captureRateLimitHeaders(response)

        let retryAfter: unknown
        let global = response.headers.get("x-ratelimit-global") === "true"
        try {
            const body = await response.clone().json() as { retry_after?: unknown, global?: unknown }
            retryAfter = body.retry_after
            if (body.global === true) global = true
        } catch {
            retryAfter = undefined
        }

        const resetAfter = Number(response.headers.get("x-ratelimit-reset-after"))
        const retryHeader = Number(response.headers.get("retry-after"))
        const retryDelays = [retryAfter, retryHeader, resetAfter]
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value))
            .map((value) => value * 1000)
        const retryDelay = this.toRetryDelay(retryDelays.length ? Math.max(...retryDelays) : 5000)

        this.rateLimitStrikes++
        const exponentialDelay = Math.max(retryDelay, 1000 * 2 ** Math.min(this.rateLimitStrikes, 8))
        this.rateLimitBackoff = Math.min(300000, exponentialDelay)
        this.rateLimitResetAt = Date.now() + this.rateLimitBackoff
        this.rateLimitGlobal = global || this.rateLimitScope === "global"
        this.lastStatusResult = `${this.rateLimitGlobal ? "Global rate limit" : "Rate limited"}; retrying in ${Math.ceil(this.rateLimitBackoff / 1000)}s`
        this.nextStatusAt = Date.now() + this.rateLimitBackoff
        // Keep a newer lyric that arrived while the 429 body was being read.
        if (!this.pendingStatus) this.pendingStatus = update
        this.saveRateLimitState()
    }

    private loadRateLimitState(): void {
        try {
            if (!existsSync(this.rateLimitStatePath)) return
            const state = JSON.parse(readFileSync(this.rateLimitStatePath, "utf8")) as Partial<RateLimitState>
            if (typeof state.nextStatusAt !== "number" || state.nextStatusAt <= Date.now()) return
            this.nextStatusAt = state.nextStatusAt
            this.rateLimitBackoff = typeof state.backoff === "number" ? Math.min(300000, Math.max(0, state.backoff)) : 0
            this.rateLimitStrikes = typeof state.strikes === "number" ? Math.min(8, Math.max(0, state.strikes)) : 0
            this.rateLimitGlobal = state.global === true
            this.rateLimitResetAt = state.nextStatusAt
            this.lastStatusResult = `Cooldown restored; retrying in ${Math.ceil((state.nextStatusAt - Date.now()) / 1000)}s`
        } catch {
            // A damaged runtime-only state file must not stop lyric updates.
        }
    }

    private saveRateLimitState(): void {
        try {
            if (this.nextStatusAt <= Date.now() && this.rateLimitStrikes === 0) {
                writeFileSync(this.rateLimitStatePath, "{}", "utf8")
                return
            }
            writeFileSync(this.rateLimitStatePath, JSON.stringify({
                nextStatusAt: this.nextStatusAt,
                backoff: this.rateLimitBackoff,
                strikes: this.rateLimitStrikes,
                global: this.rateLimitGlobal
            }), "utf8")
        } catch (error) {
            Debug.write("Could not save rate-limit state: " + (error as Error).message)
        }
    }

    private toRetryDelay(value: number): number {
        if (!Number.isFinite(value)) return 5000
        return Math.max(1000, Math.min(300000, value))
    }

    private parseEmoji(value: string): { id: string | null, name: string | null } {
        const trimmed = value.trim()
        if (containsBlockedSlur(trimmed)) return { name: "🎶", id: null }
        const customEmoji = trimmed.match(/^<a?:([^:>]+):(\d+)>$/) || trimmed.match(/^([^:<>]+):(\d+)$/)
        if (customEmoji) return { name: customEmoji[1], id: customEmoji[2] }
        return { name: trimmed || "🎶", id: null }
    }

    public formatSeconds(s: number): string {
        return (s - (s %= 60)) / 60 + (9 < s ? ':' : ':0') + s
    }

    public getStatusString(line: LyricsLine): string {
        return `${Settings.view.timestamp ? `[${this.formatSeconds(+(line.time / 1000).toFixed(0))}] ` : ""}${Settings.view.label ? "Song lyrics - " : ""}${line.text.replace("♪", "🎶")}`.slice(0, 128)
    }

    public parseStatusString(status: string): string {
        const line = this.playbackState.currentLine
        if (!line) return status.slice(0, 128)

        const songName = this.playbackState.songName
        const songAuthor = this.playbackState.songAuthor
        const lettersOnly = line.text.replace(/['",\.]/gi, "")
        const croppedName = songName.replace(/( ?- ?.+)|\(.+\)/gi, "")

        return status
            .replace("{lyrics}", line.text)
            .replace("{lyrics_upper}", line.text.toUpperCase())
            .replace("{lyrics_lower}", line.text.toLowerCase())
            .replace("{lyrics_letters_only}", lettersOnly)
            .replace("{lyrics_upper_letters_only}", lettersOnly.toUpperCase())
            .replace("{lyrics_lower_letters_only}", lettersOnly.toLowerCase())
            .replace("♪", "🎶")
            .replace("{timestamp}", this.formatSeconds(+(line.time / 1000).toFixed(0)))
            .replace("{song_name}", songName)
            .replace("{song_name_upper}", songName.toUpperCase())
            .replace("{song_name_lower}", songName.toLowerCase())
            .replace("{song_name_cropped}", croppedName)
            .replace("{song_name_upper_cropped}", croppedName.toUpperCase())
            .replace("{song_name_lower_cropped}", croppedName.toLowerCase())
            .replace("{song_author}", songAuthor)
            .replace("{song_author_upper}", songAuthor.toUpperCase())
            .replace("{song_author_lower}", songAuthor.toLowerCase())
            .slice(0, 128)
    }
}
