const assert = require("node:assert/strict")
const fs = require("node:fs")
const { Autooffset } = require("../dist/Autooffset")
const { LrcLibSource } = require("../dist/Sources/LrcLibSource")
const { SpotifySource } = require("../dist/Sources/SpotifySource")
const { SpotifyService } = require("../dist/SpotifyService")
const { LyricsFetcher } = require("../dist/LyricsFetcher")
const { StatusChanger } = require("../dist/StatusChanger")
const { PlaybackState } = require("../dist/PlaybackState")
const { reconcileProgress } = require("../dist/PlaybackStateUpdater")
const { Settings } = require("../dist/Settings")
const { containsBlockedSlur, sanitizeStatusText } = require("../dist/ContentFilter")
const { fetchWithTimeout } = require("../dist/Http")

async function main() {
    try { fs.unlinkSync("rate-limit-state.json") } catch {}
    try { fs.unlinkSync("cache/Track-Artist-Album-180.json") } catch {}
    assert.equal(new Autooffset().getAverageValue(), 0)
    assert.equal(containsBlockedSlur("n i g g e r"), true)
    assert.equal(containsBlockedSlur("nig"), true)
    assert.equal(containsBlockedSlur("n\u200Bi\u200Bg\u200Bg\u200Be\u200Br"), true)
    assert.equal(containsBlockedSlur("nіgga"), true)
    assert.equal(containsBlockedSlur("nniiggggaa"), true)
    assert.equal(containsBlockedSlur("paki"), true)
    assert.equal(containsBlockedSlur("towel-head"), true)
    assert.equal(containsBlockedSlur("redskin"), true)
    assert.equal(containsBlockedSlur("black lyric"), false)
    assert.equal(containsBlockedSlur("sex and fuck are allowed"), false)
    assert.equal(sanitizeStatusText("safe lyric"), "safe lyric")
    assert.equal(sanitizeStatusText("blocked n i g g e r lyric"), "Lyrics hidden")
    assert.equal(reconcileProgress(60000, 63000), 60750)
    assert.equal(reconcileProgress(60000, 60050), 60050)

    const lrcLib = new LrcLibSource()
    const parsedLyrics = lrcLib.parseLyrics("[00:01.5]first\n[00:02.250]second")
    assert.deepEqual(parsedLyrics.lines.map((line) => line.time), [1500, 2250])

    const originalFetch = global.fetch

    const spotifySource = new SpotifySource()
    Settings.credentials.cookies = ""
    let spotifyCalls = 0
    global.fetch = async () => {
        spotifyCalls++
        return new Response("unexpected", { status: 200 })
    }
    await assert.rejects(spotifySource.getLyrics({ name: "Track", artist: "Artist", album: "Album", duration: 180000 }), /cookies are not configured/)
    assert.equal(spotifyCalls, 0)

    Settings.credentials.cookies = "sp_dc=test"
    SpotifyService.token = "test-token"
    global.fetch = async () => new Response("RBAC: access denied", { status: 403 })
    await assert.rejects(spotifySource.getLyrics({ name: "Track", artist: "Artist", album: "Album", duration: 180000 }), /rejected the request \(403\): RBAC: access denied/)

    global.fetch = async (url) => {
        assert.match(String(url), /album_name=Album/)
        assert.match(String(url), /duration=180/)
        return new Response(JSON.stringify({
            trackName: "Track",
            artistName: "Artist",
            albumName: "Album",
            duration: 180,
            plainLyrics: "plain one\nplain two",
            syncedLyrics: null
        }), { status: 200 })
    }
    const plainLyrics = await lrcLib.getLyrics({ name: "Track", artist: "Artist", album: "Album", duration: 180000 })
    assert.deepEqual(plainLyrics.lines, [{ time: 0, text: "plain one" }, { time: 88500, text: "plain two" }])
    assert.equal(plainLyrics.isSynced, false)
    assert.equal(plainLyrics.timingEstimated, true)

    let lookupCalls = 0
    global.fetch = async (url) => {
        lookupCalls++
        if (String(url).includes("/get?")) {
            return new Response(JSON.stringify({ trackName: "Track", artistName: "Artist", albumName: "Wrong release", duration: 180, plainLyrics: "wrong", syncedLyrics: null }), { status: 200 })
        }
        return new Response(JSON.stringify([{ trackName: "Track", artistName: "Artist", albumName: "Album", duration: 180, plainLyrics: null, syncedLyrics: "[00:01.00]matched" }]), { status: 200 })
    }
    const searchedLyrics = await lrcLib.getLyrics({ name: "Track", artist: "Artist", album: "Album", duration: 180000 })
    assert.equal(lookupCalls, 2)
    assert.equal(searchedLyrics.isSynced, true)
    assert.deepEqual(searchedLyrics.lines, [{ time: 1000, text: "matched" }])

    const fetcher = new LyricsFetcher()
    fetcher.addSource({
        getAppName: () => "Test source",
        getLyrics: async () => ({ lines: [{ time: 0, text: "wrong" }], isSynced: false, track: { name: "Other", artist: "Artist", album: "Album", duration: 180000 } })
    })
    fetcher.addSource({
        getAppName: () => "Fallback source",
        getLyrics: async () => ({ lines: [{ time: 0, text: "cached" }], isSynced: false, track })
    })
    const track = { name: "Track", artist: "Artist", album: "Album", duration: 180000 }
    assert.deepEqual((await fetcher.fetchLyrics(track)).lines, [{ time: 0, text: "cached" }])
    assert.equal(fetcher.lastFetchedFrom, "Fallback source")
    assert.deepEqual(fetcher.fetchCachedLyrics({ ...track, duration: 181000 }), null)

    const sentStatuses = []
    global.fetch = async (_url, options) => {
        sentStatuses.push(JSON.parse(options.body).custom_status.text)
        return new Response(null, { status: 200 })
    }

    Settings.credentials.token = "test-token"
    Settings.timings.enableAutooffset = false
    Settings.timings.sendTimeOffset = 0
    Settings.timings.statusUpdateInterval = 800
    Settings.view.timestamp = false
    Settings.view.label = false
    Settings.view.advanced.enabled = false
    Settings.view.advanced.customEmoji = "<:party:123456789012345678>"

    const playback = new PlaybackState()
    playback.songId = "test-song"
    playback.isPlaying = true
    playback.hasLyrics = true
    playback.songDuration = 10000
    playback.lyrics = { lines: [{ time: 0, text: "first" }, { time: 1500, text: "second" }] }

    const changer = new StatusChanger(playback)
    assert.deepEqual(changer.parseEmoji("<a:party:123456789012345678>"), { name: "party", id: "123456789012345678" })
    playback.songProgress = 0
    changer.changeStatus()
    playback.songProgress = 1
    changer.changeStatus()
    await new Promise((resolve) => setTimeout(resolve, 850))
    playback.songProgress = 1600
    changer.changeStatus()
    await new Promise((resolve) => setTimeout(resolve, 850))
    changer.changeStatus()

    global.fetch = originalFetch
    assert.deepEqual(sentStatuses, ["first", "second"])

    global.fetch = async () => new Response(JSON.stringify({ retry_after: 0.01 }), {
        status: 429,
        headers: { "x-ratelimit-reset-after": "0.01", "x-ratelimit-remaining": "0", "x-ratelimit-scope": "global", "x-ratelimit-global": "true" }
    })
    const rateLimitedPlayback = new PlaybackState()
    rateLimitedPlayback.songId = "rate-limited-song"
    rateLimitedPlayback.isPlaying = true
    rateLimitedPlayback.hasLyrics = true
    rateLimitedPlayback.songProgress = 1
    rateLimitedPlayback.songDuration = 10000
    rateLimitedPlayback.lyrics = { lines: [{ time: 0, text: "retry me" }] }
    const rateLimitedChanger = new StatusChanger(rateLimitedPlayback)
    rateLimitedChanger.changeStatus()
    rateLimitedChanger.changeStatus()
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.match(rateLimitedChanger.lastStatusResult, /Global rate limit; retrying in/)
    assert.equal(rateLimitedChanger.rateLimitRemaining, 0)
    assert.equal(rateLimitedChanger.rateLimitGlobal, true)

    global.fetch = () => new Promise(() => {})
    await assert.rejects(fetchWithTimeout("http://timeout.test", {}, 20), /timed out/)
    global.fetch = originalFetch
    console.log("smoke tests passed")
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
