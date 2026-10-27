export interface LyricsLine {
    time: number
    text: string
}

export interface TrackInfo {
    name: string
    artist: string
    album: string
    duration: number
}

export interface SongLyrics {
    lines: LyricsLine[]
    isSynced?: boolean
    timingEstimated?: boolean
    track?: TrackInfo
}

export interface CachedSongLyrics extends SongLyrics {
    appName: string
}

export abstract class BaseSource {
    public abstract getLyrics(track: TrackInfo): Promise<SongLyrics>

    public abstract getAppName(): string
}
