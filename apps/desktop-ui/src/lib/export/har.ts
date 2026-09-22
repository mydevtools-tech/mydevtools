/**
 * HAR 1.2 export — drive Chrome DevTools / Firefox into our collections by
 * shape. Each saved example (or live request snapshot) becomes one HAR entry.
 * Captures method, url, headers, body, response status + body.
 */

import type { Collection, CollectionFolder, CollectionRequest, SavedExample } from "@/components/api-client/types"
import { downloadFile } from "@/lib/desktop/save-file"

interface HarHeader { name: string; value: string }

interface HarEntry {
    startedDateTime: string
    time: number
    request: {
        method: string
        url: string
        httpVersion: "HTTP/1.1"
        headers: HarHeader[]
        queryString: HarHeader[]
        postData?: { mimeType: string; text: string }
        headersSize: -1
        bodySize: number
    }
    response: {
        status: number
        statusText: string
        httpVersion: "HTTP/1.1"
        headers: HarHeader[]
        content: { size: number; mimeType: string; text: string }
        redirectURL: string
        headersSize: -1
        bodySize: number
    }
    cache: Record<string, never>
    timings: { send: number; wait: number; receive: number }
}

function pairs(obj: Record<string, string>): HarHeader[] {
    return Object.entries(obj).map(([name, value]) => ({ name, value }))
}

function* walk(items: Array<CollectionFolder | CollectionRequest>): Generator<{ req: CollectionRequest; example?: SavedExample }> {
    for (const item of items) {
        if ("type" in item && item.type === "folder") yield* walk(item.items)
        else {
            const r = item as CollectionRequest
            if (r.examples && r.examples.length > 0) {
                for (const ex of r.examples) yield { req: r, example: ex }
            } else {
                yield { req: r }
            }
        }
    }
}

function reqBodyText(req: CollectionRequest): string {
    switch (req.body.type) {
        case "json":
        case "text":
        case "graphql":
            return req.body.content ?? ""
        case "x-www-form-urlencoded": {
            const sp = new URLSearchParams()
            for (const it of req.body.urlEncoded ?? []) {
                if (it.active && it.key) sp.append(it.key, it.value)
            }
            return sp.toString()
        }
        case "form-data":
            return JSON.stringify((req.body.formData ?? []).filter((it) => it.active))
        default:
            return ""
    }
}

function reqMime(req: CollectionRequest): string {
    if (req.body.type === "json" || req.body.type === "graphql") return "application/json"
    if (req.body.type === "x-www-form-urlencoded") return "application/x-www-form-urlencoded"
    if (req.body.type === "form-data") return "multipart/form-data"
    return "text/plain"
}

export function exportCollectionAsHar(collection: Collection): string {
    const entries: HarEntry[] = []
    const now = new Date().toISOString()

    for (const { req, example } of walk(collection.items)) {
        const url = example?.request.url ?? req.url
        const method = example?.request.method ?? req.method
        const reqHeaders = example
            ? example.request.headers.filter((h) => h.active).map((h) => ({ name: h.key, value: h.value }))
            : req.headers.filter((h) => h.active).map((h) => ({ name: h.key, value: h.value }))
        const queryString: HarHeader[] = req.params.filter((p) => p.active && p.key).map((p) => ({ name: p.key, value: p.value }))

        const body = reqBodyText(req)
        const postData = body ? { mimeType: reqMime(req), text: body } : undefined

        const respStatus = example?.response.status ?? 0
        const respStatusText = example?.response.statusText ?? ""
        const respHeaders = pairs(example?.response.headers ?? {})
        const respBody = example?.response.body ?? ""
        const respMime = example?.response.contentType ?? "application/json"

        entries.push({
            startedDateTime: now,
            time: 0,
            request: {
                method,
                url,
                httpVersion: "HTTP/1.1",
                headers: reqHeaders,
                queryString,
                postData,
                headersSize: -1,
                bodySize: body.length,
            },
            response: {
                status: respStatus,
                statusText: respStatusText,
                httpVersion: "HTTP/1.1",
                headers: respHeaders,
                content: { size: respBody.length, mimeType: respMime, text: respBody },
                redirectURL: "",
                headersSize: -1,
                bodySize: respBody.length,
            },
            cache: {},
            timings: { send: 0, wait: 0, receive: 0 },
        })
    }

    return JSON.stringify({
        log: {
            version: "1.2",
            creator: { name: "mydevtools-api-client", version: "1.0" },
            entries,
        },
    }, null, 2)
}

export function downloadCollectionAsHar(collection: Collection): void {
    if (typeof window === "undefined") return
    const blob = new Blob([exportCollectionAsHar(collection)], { type: "application/json" })
    downloadFile(blob, `${collection.name.replace(/[^A-Za-z0-9_-]+/g, "_") || "collection"}.har`)
}
