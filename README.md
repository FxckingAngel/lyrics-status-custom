# LyricsStatus V3

## What is it?

LyricsStatus is a tool that changes your Discord status to lyrics of songs you listen to on Spotify!

It is written in TypeScript and runs on Node.js.

## Precautions

Before you proceed to [Setup](#Setup) please read those precautions.

This tool is provided "AS IS" and doesn't have any warranty that it will work on your machine.

I, creator of the LyricsStatus, am not responsible for any consequences that LyricsStatus can lead to.

By using it, you agree with the statements above.

## Setup

### Node.js

Firstly, you need to [download](https://nodejs.org/en) Node.js.

LyricsStatus needs version 17.x.x or higher.

### Downloading LyricsStatus

Open the [Releases](https://github.com/FxckingAngel/lyrics-status-custom/releases) page.

For basic users, download `LyricsStatus.exe` from the release's Assets section
and double-click it. The EXE is the normal Windows path and does not require
Node.js, npm, or a separate launcher. The local setup panel opens in your
browser, and the tray icon can reopen settings or quit the app.

For advanced users, download `LyricsStatus-for-friend.zip`, extract it, and use
the included files for manual inspection, troubleshooting, or source-style
launching. Do not run the EXE from inside a ZIP preview. `Start-LyricsStatus.cmd`
is available as a backup launch path; do not open `LyricsStatusLauncher.ps1`
directly.

You can also clone this repository.

For Git, use this command:

```
git clone https://github.com/FxckingAngel/lyrics-status-custom
```

### Locating to LyricsStatus

#### Windows & Linux

Copy the path to the LyricsStatus folder, often found on top of your File Explorer (`C:\Users\your_profile_name\path\to\LyricsStatus` or `/usr/name/path/to/LyricsStatus` for example).

For Windows, press `Win + R` and type `cmd`, then press `Run`.

For Linux, you need to manually open Terminal from your start menu.

In the opened window type `cd paste_path_you_copied` and press `Enter`.

### Installing modules

Now, you need to install modules. In the command prompt, run the following command:

```
npm install
```

Then wait for modules to install.

### Running and configuring

For the Windows release, use the EXE for the normal setup described above. A
LyricsStatus icon appears in the Windows system tray with Open settings and
Quit commands.
If you are running from source, install Node.js dependencies with `npm install`,
then run `npm start`.

If the panel does not open automatically, open `http://127.0.0.1:8999` in a
browser. The Account tab contains the connection settings and the other tabs
control appearance, timing, and advanced behavior.

The Discord custom-status integration uses an account credential in the `Token` field. Treat it like a password: do not extract it from browser developer tools, share it, or commit it to a repository. A normal Discord bot token is not accepted by the personal custom-status endpoint.

For Spotify, create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), enter its Client ID and Client Secret, and register `http://127.0.0.1:8999/callback/` as the redirect URI. The URI must match exactly, including the final slash. Authorize the account from the panel. Spotify cookies are optional and should never be shared or committed.

The Windows package includes `FRIEND-SETUP.txt` with the same steps and
troubleshooting notes. Each person must use their own Spotify authorization and
their own Discord account credential. The package does not include yours.

Start some song in Spotify, if it has lyrics, you should see current lyrics in your command prompt as well as in your Discord status.

### Lyrics lookup order and limits

LyricsStatus queries LRCLIB first using the Spotify title, primary artist, album, and duration. If the direct result is missing or points to another release, it searches LRCLIB candidates and accepts only an exact metadata match. Synchronized lyrics are preferred; plain lyrics are used when LRCLIB has no synchronized version. Results are cached with the same metadata, so a cached result for a different release is not reused.

Spotify's lyric endpoint is tried after LRCLIB and requires the Spotify authorization already configured for playback. Spotify cookies may also be needed for its Web Player lyric endpoint. NetEase and QQ are used as lower-confidence final fallbacks when the stronger sources have no result. No lyric service can provide every song, version, language, or region, and duration/title/artist checks are used to avoid accepting an unrelated release.

The older NetEase and QQ endpoints are not enabled by default because their public search responses do not provide enough release and duration metadata to guarantee an exact match. LRCLIB and Spotify are the currently enabled integrations; neither requires a separate lyrics API key, but Spotify still requires valid Spotify credentials.

### Discord rate limits

Status updates are queued so only the newest lyric waits to be sent. LyricsStatus reads Discord's rate-limit headers and 429 response body, respects the longest reported retry delay, distinguishes global limits, and uses capped exponential backoff for repeated failures. The cooldown is saved in `rate-limit-state.json` so restarting the app does not immediately repeat a blocked request.

### Automatic executable updates

The desktop shortcut now starts `LyricsStatusLauncher.ps1`. The launcher keeps the executable outside the update operation, checks the configured HTTPS manifest every 60 seconds, verifies the downloaded file with its SHA-256 value, keeps a rollback copy, and restarts LyricsStatus after an update. A manifest must provide `version`, `url`, and `sha256`; without a newer valid manifest, the current executable is started unchanged.

Updates do not replace `settings.json`, the lyric cache, or
`rate-limit-state.json`. Re-run `Start-LyricsStatus.cmd` after an update; do not
reconfigure the app unless the panel reports a credential problem.

### Troubleshooting

#### Windows

If the panel does not open, allow the app through the private-network firewall
prompt and open `http://127.0.0.1:8999` manually. If Spotify authorization
fails, verify the exact redirect URI and the Spotify app's allowed users. A
Discord `401` means the account credential was rejected; it is not a rate-limit
response. A normal bot token is not accepted by the personal custom-status
endpoint.

#### Linux

Try running Terminal from `su` user.

