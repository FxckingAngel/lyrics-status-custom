import { PlaybackState } from "./PlaybackState"
import { LyricsFetcher } from "./LyricsFetcher"
import { SpotifyService } from "./SpotifyService"
import { Settings } from "./Settings"
import { ExternalAuthServerAPI } from "./ExternalAuthServerAPI"
import { fetchWithTimeout } from "./Http"

interface PlaybackResponse {
    item: {
        name: string
        id: string

        artists: {
            name: string
        }[]

        album: {
            name: string
        }

        duration_ms: number
    } | null

    progress_ms: number

    is_playing: boolean
}

export class PlaybackStateUpdater {
    public playbackState: PlaybackState

    public lyricsFetcher: LyricsFetcher
    private lastSpotifySyncAt: number

    constructor(playbackState: PlaybackState, lyricsFetcher: LyricsFetcher) {
        this.playbackState = playbackState

        this.lyricsFetcher = lyricsFetcher
        this.lastSpotifySyncAt = 0
    }

    public async update(): Promise<void> {
        const roundTripTimeStart = Date.now()
        const request = await fetchWithTimeout("https://api.spotify.com/v1/me/player", {
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + SpotifyService.token
            }
        })

        if (request.status === 401 || request.status === 400) {
            if (Settings.credentials.useExternalAuthServer) {
                SpotifyService.token = await ExternalAuthServerAPI.getToken() || ""
            } else {
                return await SpotifyService.refresh()
            }
        }
        if (request.status === 204) {
            this.resetPlayback()
            return
        }
        if (request.status === 200) {
            const json = await request.json() as PlaybackResponse
            const playbackState = this.playbackState

            if (!json.item) {
                this.resetPlayback()
                return
            }

            if (!Number.isFinite(json.progress_ms) || !Number.isFinite(json.item.duration_ms) || json.item.artists.length === 0) {
                throw new Error("Spotify returned an invalid playback item")
            }

            const responseReceivedAt = Date.now()
            const measuredProgress = json.progress_ms + Math.round((responseReceivedAt - roundTripTimeStart) / 2)
            const sameSong = playbackState.songId === json.item.id
            if (sameSong && json.is_playing && playbackState.isPlaying && this.lastSpotifySyncAt > 0) {
                const elapsed = responseReceivedAt - this.lastSpotifySyncAt
                const predictedProgress = playbackState.songProgress + elapsed
                const correction = Math.max(-750, Math.min(750, measuredProgress - predictedProgress))
                playbackState.songProgress = Math.max(0, predictedProgress + correction)
            } else {
                playbackState.songProgress = measuredProgress
            }
            this.lastSpotifySyncAt = responseReceivedAt
            playbackState.isPlaying = json.is_playing

            if (playbackState.songId !== (json.item && json.item.id)) {
                playbackState.songName = json.item.name.replace(/ \(.+\)/, "")
                playbackState.songAuthor = json.item.artists[0].name

                playbackState.oldSongId = playbackState.songId
                playbackState.songId = json.item.id

                playbackState.songDuration = json.item.duration_ms

                playbackState.lyrics = await this.lyricsFetcher.fetchLyrics({ name: playbackState.songName, artist: playbackState.songAuthor, album: json.item.album.name, duration: json.item.duration_ms })
                playbackState.currentLine = null
                playbackState.hasLyrics = !!playbackState.lyrics;
            }
            if (this.lyricsFetcher.lastFetchedFor !== `${playbackState.songName}-${playbackState.songAuthor}-${json.item.album.name}-${Math.round(json.item.duration_ms / 1000)}`) {
                // If song switches, and we didn't get lyrics of previous song yet, wrong lyrics may set. Check for wrong lyrics and set correct lyrics
                playbackState.lyrics = await this.lyricsFetcher.fetchLyrics({ name: playbackState.songName, artist: playbackState.songAuthor, album: json.item.album.name, duration: json.item.duration_ms })
            }
        }
    }

    private resetPlayback(): void {
        this.lastSpotifySyncAt = 0
        this.playbackState.isPlaying = false
        this.playbackState.songId = ""
        this.playbackState.songName = ""
        this.playbackState.songAuthor = ""
        this.playbackState.songDuration = 0
        this.playbackState.songProgress = 0
        this.playbackState.lyrics = null
        this.playbackState.currentLine = null
        this.playbackState.hasLyrics = false
    }
}
