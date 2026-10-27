import { BaseSource, SongLyrics, TrackInfo } from "./BaseSource"
import { Settings } from "../Settings"
import { SpotifyService } from "../SpotifyService"
import { fetchWithTimeout } from "../Http"

interface PlayerResponse {
    item: {
        id: string
    }
}

interface LyricsResponse {
    lyrics: {
        showUpsell: boolean
        syncType: string
        lines: {
            startTimeMs: string
            words: string
        }[]
    }
}

export class SpotifySource extends BaseSource {
    public request(url: string): Promise<Response> {
        if (!Settings.credentials.cookies.trim()) {
            return Promise.reject(new Error("Spotify Web Player cookies are not configured"))
        }

        return fetchWithTimeout(url, {
            "headers": {
                "accept": "application/json",
                "accept-language": "ru",
                "app-platform": "WebPlayer",
                "authorization": "Bearer " + SpotifyService.token,
                "spotify-app-version": "1.2.40.176.g6d58cb73",
                "Cookie": Settings.credentials.cookies
            },
            "referrer": "https://open.spotify.com/",
            "referrerPolicy": "strict-origin-when-cross-origin",
            "body": null,
            "method": "GET",
        })
    }

    public async getSongId(): Promise<string> {
        const request = await this.request("https://api.spotify.com/v1/me/player")
        const json = await this.readJson<PlayerResponse>(request)

        if (!json.item || typeof json.item.id !== "string" || !json.item.id) throw new Error("Spotify returned no playable track")

        return json.item.id
    }

    public async getLyrics(track: TrackInfo): Promise<SongLyrics> {
        const songId = await this.getSongId()

        const request = await this.request(
            `https://spclient.wg.spotify.com/color-lyrics/v2/track/${songId}?format=json&vocalRemoval=false&market=from_token`
        )
        const json = await this.readJson<LyricsResponse>(request)

        if (!json.lyrics || json.lyrics.showUpsell || json.lyrics.syncType === "UNSYNCED") throw new Error("Spotify returned no synchronized lyrics")

        return { ...this.parseLyrics(json.lyrics.lines), isSynced: true, track }
    }

    private async readJson<T>(response: Response): Promise<T> {
        if (!response.ok) {
            const body = (await response.text()).trim().replace(/\s+/g, " ").slice(0, 160)
            if (response.status === 401 || response.status === 403) {
                throw new Error(`Spotify Web Player rejected the request (${response.status})${body ? `: ${body}` : ""}`)
            }
            throw new Error(`Spotify lyrics request failed (${response.status})${body ? `: ${body}` : ""}`)
        }

        return await response.json() as T
    }

    public parseLyrics(lines: LyricsResponse["lyrics"]["lines"]): SongLyrics {
        const result: SongLyrics = {
            lines: []
        }

        for (const line of lines) {
            result.lines.push({
                time: +line.startTimeMs,
                text: line.words
            })
        }

        return result
    }

    public getAppName(): string {
        return "Spotify"
    }
}
