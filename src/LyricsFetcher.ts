import { BaseSource, CachedSongLyrics, SongLyrics, TrackInfo } from "./Sources/BaseSource"
import { existsSync, mkdirSync, renameSync, writeFileSync, readFileSync } from "fs"
import { join, relative, resolve, sep } from "path"
import { Debug } from "./Debug"

export class LyricsFetcher {
    private static readonly retryDelayMs = 30000
    public sources: BaseSource[]

    public lastFetchedFrom: string
    public lastFetchedFor: string
    private lastFetchAttemptAt: number
    private lastFetchSucceeded: boolean

    constructor() {
        this.sources = []

        this.lastFetchedFrom = "Not fetched"
        this.lastFetchedFor = ""
        this.lastFetchAttemptAt = 0
        this.lastFetchSucceeded = false
    }

    public addSource(source: BaseSource): void {
        this.sources.push(source)
    }

    public async fetchLyrics(track: TrackInfo): Promise<SongLyrics | null> {
        const trackKey = this.getTrackKey(track)
        const now = Date.now()
        if (this.lastFetchedFor === trackKey && !this.lastFetchSucceeded && now - this.lastFetchAttemptAt < LyricsFetcher.retryDelayMs) return null

        this.lastFetchedFrom = "Not fetched"
        this.lastFetchedFor = trackKey
        this.lastFetchAttemptAt = now
        this.lastFetchSucceeded = false

        const cache = this.fetchCachedLyrics(track)

        if (cache && cache.lines.length > 0) {
            this.lastFetchedFrom = `Cache (${cache.appName})`
            this.lastFetchSucceeded = true
            return cache
        }

        for (const source of this.sources) {
            try {
                const result = await source.getLyrics(track)
                if (!result || result.lines.length === 0) continue
                if (result.track && !this.matchesTrack(result.track, track)) throw new Error("Source returned a different track")

                this.lastFetchedFrom = source.getAppName()
                this.cacheLyrics(track, { ...result, track }, this.lastFetchedFrom)
                this.lastFetchSucceeded = true
                return result
            } catch (error) {
                Debug.write(`Lyrics source ${source.getAppName()} failed: ${(error as Error).message}`)
            }
        }

        return null
    }

    public fetchCachedLyrics(track: TrackInfo): CachedSongLyrics | null {
        const paths = [this.getCachePath(track)]
        const legacyPath = join(".", "cache", `${track.name}-${track.artist}.json`)
        const cacheRoot = resolve(".", "cache")
        const relativeLegacyPath = relative(cacheRoot, resolve(legacyPath))

        if (relativeLegacyPath && !relativeLegacyPath.startsWith("..") && !relativeLegacyPath.includes(".." + sep)) {
            paths.push(legacyPath)
        }

        for (const path of paths) {
            try {
                const lyrics = JSON.parse(readFileSync(path, "utf8")) as CachedSongLyrics
                if (lyrics && Array.isArray(lyrics.lines) && typeof lyrics.appName === "string" && lyrics.track && this.matchesTrack(lyrics.track, track)) return lyrics
            } catch {}
        }

        return null
    }

    public cacheLyrics(track: TrackInfo, lyrics: SongLyrics, appName: string): void {
        if (!existsSync("./cache")) mkdirSync("./cache")

        const path = this.getCachePath(track)
        const temporaryPath = path + ".tmp"
        writeFileSync(temporaryPath, JSON.stringify({
            ...lyrics,
            appName
        }), "utf8")
        renameSync(temporaryPath, path)
    }

    private getCachePath(track: TrackInfo): string {
        return join(".", "cache", encodeURIComponent(this.getTrackKey(track)) + ".json")
    }

    private getTrackKey(track: TrackInfo): string {
        return `${track.name}-${track.artist}-${track.album}-${Math.round(track.duration / 1000)}`
    }

    private matchesTrack(candidate: TrackInfo, requested: TrackInfo): boolean {
        const normalize = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
        const sameText = (a: string, b: string): boolean => normalize(a) === normalize(b)
        const durationMatches = candidate.duration <= 0 || Math.abs(candidate.duration - requested.duration) <= 8000
        return sameText(candidate.name, requested.name) && sameText(candidate.artist, requested.artist) && durationMatches
    }
}
