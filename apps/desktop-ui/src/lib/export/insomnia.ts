/**
 * Insomnia v4 export. Insomnia's JSON shape: a top-level wrapper with
 * `_type = "export"`, a list of resources where each resource has a `_type`
 * field (`workspace`, `request_group`, `request`).
 */

import type { Collection, CollectionFolder, CollectionRequest } from "@/components/api-client/types"
import { downloadFile } from "@/lib/desktop/save-file"

interface InsomniaRequest {
    _id: string
    _type: "request"
    parentId: string
    modified: number
    created: number
    url: string
    name: string
    method: string
    body: { mimeType?: string; text?: string }
    parameters: Array<{ name: string; value: string }>
    headers: Array<{ name: string; value: string }>
    authentication: Record<string, string>
}

interface InsomniaFolder {
    _id: string
    _type: "request_group"
    parentId: string
    name: string
    modified: number
    created: number
}

interface InsomniaWorkspace {
    _id: string
    _type: "workspace"
    name: string
    description: string
    scope: "collection"
}

type InsomniaResource = InsomniaRequest | InsomniaFolder | InsomniaWorkspace

function mimeFor(req: CollectionRequest): string {
    switch (req.body.type) {
        case "json":
        case "graphql":
            return "application/json"
        case "text": return "text/plain"
        case "x-www-form-urlencoded": return "application/x-www-form-urlencoded"
        case "form-data": return "multipart/form-data"
        default: return ""
    }
}

function bodyText(req: CollectionRequest): string {
    if (req.body.type === "json" || req.body.type === "text" || req.body.type === "graphql") {
        return req.body.content ?? ""
    }
    if (req.body.type === "x-www-form-urlencoded") {
        const sp = new URLSearchParams()
        for (const it of req.body.urlEncoded ?? []) {
            if (it.active && it.key) sp.append(it.key, it.value)
        }
        return sp.toString()
    }
    return ""
}

function authObj(req: CollectionRequest): Record<string, string> {
    if (req.auth.type === "bearer") return { type: "bearer", token: req.auth.token ?? "" }
    if (req.auth.type === "basic") return { type: "basic", username: req.auth.username ?? "", password: req.auth.password ?? "" }
    if (req.auth.type === "api-key") return { type: "apikey", key: req.auth.apiKeyKey ?? "", value: req.auth.apiKeyValue ?? "" }
    return { type: "none" }
}

function walk(
    items: Array<CollectionFolder | CollectionRequest>,
    parentId: string,
    out: InsomniaResource[],
    now: number,
): void {
    for (const item of items) {
        if ("type" in item && item.type === "folder") {
            const folder: InsomniaFolder = {
                _id: `fld_${item.id}`,
                _type: "request_group",
                parentId,
                name: item.name,
                modified: now,
                created: now,
            }
            out.push(folder)
            walk(item.items, folder._id, out, now)
        } else {
            const r = item as CollectionRequest
            const text = bodyText(r)
            const req: InsomniaRequest = {
                _id: `req_${r.id}`,
                _type: "request",
                parentId,
                modified: now,
                created: now,
                url: r.url,
                name: r.name,
                method: r.method,
                body: text ? { mimeType: mimeFor(r), text } : {},
                parameters: r.params.filter((p) => p.active && p.key).map((p) => ({ name: p.key, value: p.value })),
                headers: r.headers.filter((h) => h.active && h.key).map((h) => ({ name: h.key, value: h.value })),
                authentication: authObj(r),
            }
            out.push(req)
        }
    }
}

export function exportCollectionAsInsomnia(collection: Collection): string {
    const now = Date.now()
    const ws: InsomniaWorkspace = {
        _id: `wrk_${collection.id}`,
        _type: "workspace",
        name: collection.name,
        description: "Exported from mydevtools",
        scope: "collection",
    }
    const resources: InsomniaResource[] = [ws]
    walk(collection.items, ws._id, resources, now)
    return JSON.stringify({
        _type: "export",
        __export_format: 4,
        __export_date: new Date(now).toISOString(),
        __export_source: "mydevtools.api-client",
        resources,
    }, null, 2)
}

export function downloadCollectionAsInsomnia(collection: Collection): void {
    if (typeof window === "undefined") return
    const blob = new Blob([exportCollectionAsInsomnia(collection)], { type: "application/json" })
    downloadFile(blob, `${collection.name.replace(/[^A-Za-z0-9_-]+/g, "_") || "collection"}.insomnia.json`)
}
