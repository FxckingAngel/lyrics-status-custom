import { BaseSource, SongLyrics, TrackInfo } from "./BaseSource"
import { fetchWithTimeout } from "../Http"

interface LyricsResponse {
    id: number
    name: string
    trackName: string
    artistName: string
    albumName: string
    plainLyrics: string | null
    syncedLyrics: string | null
    duration: number
}

/**
 * Lyrics but using LrcLib
 * https://lrclib.net/api
 */
export class LrcLibSource extends BaseSource {
    private readonly baseUrl = "https://lrclib.net/api"

    public async getLyrics(track: TrackInfo): Promise<SongLyrics> {
        const query = new URLSearchParams({
            track_name: track.name,
            artist_name: track.artist,
            album_name: track.album,
            duration: String(Math.round(track.duration / 1000))
        })
        const response = await fetchWithTimeout(`${this.baseUrl}/get?${query}`)
        if (response.ok) {
            const result = this.toSongLyrics(await response.json() as LyricsResponse, track)
            if (this.matchesTrack(result.track, track, true)) return result
        }

        try {
            return await this.searchLyrics(track, true)
        } catch {
            return await this.searchLyrics(track, false)
        }
    }

    private async searchLyrics(track: TrackInfo, includeAlbum: boolean): Promise<SongLyrics> {
        const query = new URLSearchParams({ track_name: track.name, artist_name: track.artist })
        if (includeAlbum) query.set("album_name", track.album)
        const response = await fetchWithTimeout(`${this.baseUrl}/search?${query}`)
        if (!response.ok) throw new Error(`Lookup failed: ${response.status}`)

        const candidates = await response.json() as LyricsResponse[]
        const result = candidates
            .map((candidate) => this.toSongLyrics(candidate, track))
            .filter((candidate) => candidate.lines.length > 0 && this.matchesTrack(candidate.track, track))
            .sort((a, b) => {
                const syncedDifference = Number(Boolean(b.isSynced)) - Number(Boolean(a.isSynced))
                if (syncedDifference) return syncedDifference
                const scoreDifference = this.matchScore(b.track, track) - this.matchScore(a.track, track)
                if (scoreDifference) return scoreDifference
                return this.durationDifference(a.track, track) - this.durationDifference(b.track, track)
            })[0]

        if (!result) throw new Error("No exact lyrics match found")
        return result
    }

    private toSongLyrics(json: LyricsResponse, requestedTrack: TrackInfo): SongLyrics & { track: TrackInfo } {
        const track: TrackInfo = {
            name: json.trackName || json.name,
            artist: json.artistName,
            album: json.albumName,
            duration: json.duration * 1000
        }
        const synced = json.syncedLyrics?.trim()
        if (synced) return { ...this.parseLyrics(synced), isSynced: true, track }

        const plain = json.plainLyrics?.trim()
        if (plain) {
            const lines = plain.split(/\r?\n/).filter(Boolean).map((text) => text.trim())
            return {
                lines: this.estimatePlainTimings(lines, requestedTrack.duration),
                isSynced: false,
                timingEstimated: true,
                track
            }
        }
        return { lines: [], isSynced: false, track }
    }

    private estimatePlainTimings(lines: string[], duration: number): { time: number, text: string }[] {
        if (lines.length < 2 || duration <= 0) return lines.map((text) => ({ time: 0, text }))

        const usableDuration = Math.max(1000, duration - 3000)
        const weights = lines.map((text) => Math.max(8, Math.min(80, text.length)))
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
        let elapsedWeight = 0

        return lines.map((text, index) => {
            const time = index === 0 ? 0 : Math.round((elapsedWeight / totalWeight) * usableDuration)
            elapsedWeight += weights[index]
            return { time, text }
        })
    }

    private matchesTrack(candidate: TrackInfo, requested: TrackInfo, requireAlbum = false): boolean {
        const score = this.matchScore(candidate, requested)
        const durationMatches = candidate.duration <= 0 || Math.abs(candidate.duration - requested.duration) <= 8000
        const albumMatches = this.normalize(candidate.album) === this.normalize(requested.album)
        return score >= 2 && durationMatches && (!requireAlbum || albumMatches)
    }

    private matchScore(candidate: TrackInfo, requested: TrackInfo): number {
        const titleMatches = this.normalize(candidate.name) === this.normalize(requested.name)
        const artistMatches = this.normalize(candidate.artist) === this.normalize(requested.artist)
        const albumMatches = this.normalize(candidate.album) === this.normalize(requested.album)
        return (titleMatches ? 3 : 0) + (artistMatches ? 3 : 0) + (albumMatches ? 1 : 0)
    }

    private normalize(value: string): string {
        return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
    }

    private durationDifference(candidate: TrackInfo, requested: TrackInfo): number {
        return candidate.duration > 0 ? Math.abs(candidate.duration - requested.duration) : Number.MAX_SAFE_INTEGER
    }

        /**
         * Convert the response to the .json format we use
         */
        private parseLyrics(lyrics: string): SongLyrics {
            const result: SongLyrics = { lines: [] }
            const lines = lyrics.split("\n")

            // it should be: [mm:ss.xx] text
            const regexp = /\[(\d+):(\d\d)(?:\.(\d{1,3}))?]/g

            for (let line of lines) {
                if (!line.trim()) continue

                    const timestamps: number[] = []
                    let match: RegExpExecArray | null

                    while ((match = regexp.exec(line)) !== null) {
                        const min = parseInt(match[1])
                        const sec = parseInt(match[2])
                        const ms = match[3] ? parseInt(match[3].padEnd(3, "0")) : 0
                        timestamps.push((min * 60 + sec) * 1000 + ms)
                    }

                    const text = line.replace(regexp, "").trim()
                    if (!text) continue

                        for (const time of timestamps.length ? timestamps : [0]) {
                            result.lines.push({ time, text })
                        }
            }

            result.lines.sort((a, b) => a.time - b.time)
            return result
        }

        public getAppName(): string {
            return "LrcLib"
        }
}
