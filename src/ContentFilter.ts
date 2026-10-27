const blockedTerms = [
    "nigger", "nigga", "nig", "kike", "chink", "spic", "gook", "wetback", "beaner",
    "raghead", "sandnigger", "coon", "faggot", "tranny", "dyke", "paki", "wog", "jigaboo",
    "sambo", "darkie", "towelhead", "camel jockey", "redskin", "zipperhead", "polack", "kraut"
]

function normalize(value: string): string {
    return value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .toLowerCase()
        .replace(/[а-яёіїєґ]/g, (character) => ({
            "а": "a", "в": "b", "с": "c", "е": "e", "н": "h", "і": "i", "к": "k",
            "м": "m", "о": "o", "р": "p", "т": "t", "х": "x", "у": "y", "ѕ": "s", "ј": "j"
        }[character] || character))
        .replace(/[αβϲеηικοрτχυ]/g, (character) => ({
            "α": "a", "β": "b", "ϲ": "c", "е": "e", "η": "h", "ι": "i", "κ": "k",
            "ο": "o", "р": "p", "τ": "t", "χ": "x", "υ": "y"
        }[character] || character))
        .replace(/[0@]/g, "o")
        .replace(/[1!|]/g, "i")
        .replace(/[3]/g, "e")
        .replace(/[4@]/g, "a")
        .replace(/[5$]/g, "s")
        .replace(/[7]/g, "t")
}

export function containsBlockedSlur(value: string): boolean {
    const normalized = normalize(value)
    const compact = normalized.replace(/[^a-z0-9]/g, "")
    const collapsed = compact.replace(/(.)\1+/g, "$1")

    return blockedTerms.some((term) => {
        const separatedTerm = term.split("").join("[^a-z0-9]*")
        const wholeWord = new RegExp(`(^|[^a-z0-9])${separatedTerm}($|[^a-z0-9])`).test(normalized)
        const collapsedTerm = term.replace(/(.)\1+/g, "$1")
        return wholeWord || (term.length >= 5 && (compact.includes(term) || collapsed.includes(term) || collapsed.includes(collapsedTerm)))
    })
}

export function sanitizeStatusText(value: string): string {
    return containsBlockedSlur(value) ? "Lyrics hidden" : value
}
