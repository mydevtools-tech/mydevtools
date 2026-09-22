/**
 * Postman Collection v2.1 export — round-trips with `lib/import/postman.ts`
 * for the same subset of features. Pre-request + test scripts come along
 * as `event[]` entries.
 */
import { downloadFile } from "@/lib/desktop/save-file"

import type {
    Collection,
    CollectionFolder,
    CollectionRequest,
    RequestAuth,
    RequestBody,
} from "@/components/api-client/types"

interface PostmanEventOut {
    listen: "prerequest" | "test"
    script: { type: "text/javascript"; exec: string[] }
}

interface PostmanItemOut {
    name: string
    item?: PostmanItemOut[]
    request?: unknown
    event?: PostmanEventOut[]
}

const POSTMAN_SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"

function makeScriptEvent(listen: "prerequest" | "test", script: string): PostmanEventOut {
    return {
        listen,
        script: { type: "text/javascript", exec: script.split(/\r?\n/) },
    }
}

function exportAuth(auth: RequestAuth): unknown {
    if (!auth || auth.type === "none") return undefined
    if (auth.type === "bearer") {
        return {
            type: "bearer",
            bearer: [{ key: "token", value: auth.token ?? "", type: "string" }],
        }
    }
    if (auth.type === "basic") {
        return {
            type: "basic",
            basic: [
                { key: "username", value: auth.username ?? "", type: "string" },
                { key: "password", value: auth.password ?? "", type: "string" },
            ],
        }
    }
    if (auth.type === "api-key") {
        return {
            type: "apikey",
            apikey: [
                { key: "key", value: auth.apiKeyKey ?? "", type: "string" },
                { key: "value", value: auth.apiKeyValue ?? "", type: "string" },
                { key: "in", value: auth.apiKeyLocation ?? "header", type: "string" },
            ],
        }
    }
    if (auth.type === "oauth2" && auth.oauth2) {
        const o = auth.oauth2
        const entries: Array<{ key: string; value: string; type: "string" }> = []
        const push = (key: string, value: string | undefined) => {
            if (value) entries.push({ key, value, type: "string" })
        }
        push("grant_type", o.grantType)
        push("accessTokenUrl", o.tokenUrl)
        push("authUrl", o.authUrl)
        push("clientId", o.clientId)
        push("clientSecret", o.clientSecret)
        push("scope", o.scope)
        push("audience", o.audience)
        push("redirectUri", o.redirectUri)
        push("accessToken", o.accessToken)
        return { type: "oauth2", oauth2: entries }
    }
    return undefined
}

function exportBody(b: RequestBody): unknown {
    if (!b || b.type === "none") return undefined
    if (b.type === "json") {
        return {
            mode: "raw",
            raw: b.content,
            options: { raw: { language: "json" } },
        }
    }
    if (b.type === "text") {
        return { mode: "raw", raw: b.content }
    }
    if (b.type === "x-www-form-urlencoded") {
        return {
            mode: "urlencoded",
            urlencoded: (b.urlEncoded ?? [])
                .filter((kv) => kv.key)
                .map((kv) => ({ key: kv.key, value: kv.value, disabled: !kv.active })),
        }
    }
    if (b.type === "form-data") {
        return {
            mode: "formdata",
            formdata: (b.formData ?? [])
                .filter((kv) => kv.key)
                .map((kv) =>
                    kv.valueType === "file"
                        ? {
                            key: kv.key,
                            type: "file",
                            src: kv.fileName ? [kv.fileName] : [],
                            disabled: !kv.active,
                        }
                        : { key: kv.key, value: kv.value, type: "text", disabled: !kv.active },
                ),
        }
    }
    return undefined
}

function exportRequest(r: CollectionRequest): unknown {
    return {
        method: r.method,
        header: r.headers
            .filter((h) => h.key)
            .map((h) => ({ key: h.key, value: h.value, disabled: !h.active })),
        url: {
            raw: r.url,
            query: r.params
                .filter((p) => p.key)
                .map((p) => ({ key: p.key, value: p.value, disabled: !p.active })),
        },
        body: exportBody(r.body),
        auth: exportAuth(r.auth),
    }
}

function exportItem(item: CollectionFolder | CollectionRequest): PostmanItemOut {
    if ("type" in item && item.type === "folder") {
        return { name: item.name, item: item.items.map(exportItem) }
    }
    const req = item as CollectionRequest
    const out: PostmanItemOut = { name: req.name, request: exportRequest(req) }
    const events: PostmanEventOut[] = []
    if (req.preRequestScript && req.preRequestScript.trim()) events.push(makeScriptEvent("prerequest", req.preRequestScript))
    if (req.testScript && req.testScript.trim()) events.push(makeScriptEvent("test", req.testScript))
    if (events.length > 0) out.event = events
    return out
}

export function exportPostmanCollection(collection: Collection): string {
    return JSON.stringify(
        {
            info: {
                _postman_id: collection.id,
                name: collection.name,
                schema: POSTMAN_SCHEMA,
            },
            item: collection.items.map(exportItem),
        },
        null,
        2,
    )
}

/** Trigger a browser download of the JSON. */
export function downloadCollectionAsPostman(collection: Collection): void {
    if (typeof window === "undefined") return
    const json = exportPostmanCollection(collection)
    const blob = new Blob([json], { type: "application/json" })
    downloadFile(blob, `${collection.name.replace(/[^a-zA-Z0-9-_]+/g, "_") || "collection"}.postman_collection.json`)
}
