import { readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { Debug } from "./Debug"

type SettingsObject = Record<string, unknown>

function mergeSettings<T extends SettingsObject>(defaults: T, value: unknown): T {
    if (!value || typeof value !== "object" || Array.isArray(value)) return defaults

    const result: SettingsObject = { ...defaults }
    for (const [key, defaultValue] of Object.entries(defaults)) {
        const incomingValue = (value as SettingsObject)[key]
        if (defaultValue && typeof defaultValue === "object" && !Array.isArray(defaultValue)) {
            result[key] = mergeSettings(defaultValue as SettingsObject, incomingValue)
        } else if (incomingValue !== undefined && typeof incomingValue === typeof defaultValue) {
            result[key] = incomingValue
        }
    }

    return result as T
}

export class Settings {
    private static readonly dataDirectory = Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg)
        ? dirname(process.execPath)
        : process.cwd()

    public static readonly filePath = join(Settings.dataDirectory, "settings.json")

    public static credentials = {
        token: "",
        cookies: "",
        clientID: "",
        clientSecret: "",
        useExternalAuthServer: false,
        code: "",
        refreshToken: "",
        uuid: "",
        customRedirectUri: ""
    }

    public static view = {
        timestamp: true,
        label: true,
        advanced: {
            enabled: false,
            customEmoji: "🎶",
            customStatus: "[{timestamp}] [{lyrics}]"
        }
    }

    public static timings = {
        sendTimeOffset: 500,
        enableAutooffset: true,
        autooffset: 3,
        statusUpdateInterval: 800
    }

    public static update = {
        enableAutoupdate: true
    }

    public static save(): void {
        const contents = JSON.stringify({
            credentials: this.credentials,
            view: this.view,
            timings: this.timings,
            update: this.update
        }, null, 2)
        const temporaryPath = Settings.filePath + ".tmp"

        try {
            writeFileSync(temporaryPath, contents, "utf8")
            renameSync(temporaryPath, Settings.filePath)
        } catch (error) {
            Debug.write("An error occurred while saving settings: " + (error as Error).stack)
        }
    }

    public static load(): void {
        let settings

        try {
            settings = JSON.parse(readFileSync(Settings.filePath).toString())
        } catch(e) {
            Debug.write("An error occurred while trying to read settings from file. Using defaults. Error: " + (e as Error).stack)
        }

        if (settings) {
            this.apply(settings)
        }
    }

    public static apply(settings: unknown): void {
        if (!settings || typeof settings !== "object") return

        const value = settings as SettingsObject
        this.credentials = mergeSettings(this.credentials, value.credentials)
        this.view = mergeSettings(this.view, value.view)
        this.timings = mergeSettings(this.timings, value.timings)
        this.update = mergeSettings(this.update, value.update)
        this.timings.sendTimeOffset = Math.max(-2000, Math.min(5000, this.timings.sendTimeOffset))
        this.timings.autooffset = Math.max(1, Math.min(20, Math.round(this.timings.autooffset)))
        this.timings.statusUpdateInterval = Math.max(800, Math.min(5000, this.timings.statusUpdateInterval))
    }
}
