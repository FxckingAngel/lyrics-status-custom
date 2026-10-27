import fetch from "node-fetch"
import AbortControllerPolyfill from "abort-controller"

export async function fetchWithTimeout(input: string | URL, init: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
    const controller = typeof globalThis.AbortController === "function"
        ? new globalThis.AbortController()
        : new AbortControllerPolyfill()
    let timeout: NodeJS.Timeout | undefined
    const request = (typeof globalThis.fetch === "function"
        ? globalThis.fetch(input, { ...init, signal: controller.signal as any })
        : fetch(input, { ...init, signal: controller.signal } as any)) as unknown as Promise<Response>
    const timeoutError = new Promise<Response>((_resolve, reject) => {
        timeout = setTimeout(() => {
            controller.abort()
            reject(new Error(`Request timed out after ${timeoutMs}ms`))
        }, timeoutMs)
    })

    try {
        return await Promise.race([request, timeoutError])
    } finally {
        if (timeout) clearTimeout(timeout)
    }
}
