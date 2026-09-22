/**
 * Collection → OpenAPI 3.0 export.
 *
 * Strategy:
 *   - Group URLs by origin → first shared origin becomes `servers[0].url`.
 *   - Each unique pathname becomes a path. HTTP method blocks under it.
 *   - Folder name → operation tag (collection name fallback).
 *   - Active query params → operation parameters (`in: query`).
 *   - Active headers (excluding auth / accept-language / content-type) → `in: header` parameters.
 *   - JSON body → `requestBody` with a synthesised schema from sample values.
 *   - Form bodies → urlencoded/multipart media types.
 *
 * Output is a JSON OpenAPI 3.0 document. YAML conversion can be done with `js-yaml`
 * client-side if needed.
 */
import { downloadFile } from "@/lib/desktop/save-file"

import type {
    Collection,
    CollectionFolder,
    CollectionRequest,
    KeyValueItem,
    RequestBody,
} from "@/components/api-client/types"

interface OpenAPIParameter {
    name: string
    in: "query" | "header"
    required?: boolean
    schema: { type: string; example?: unknown }
}

interface OpenAPISchema {
    type?: string
    items?: OpenAPISchema
    properties?: Record<string, OpenAPISchema>
    example?: unknown
}

interface OpenAPIOperation {
    summary?: string
    tags?: string[]
    parameters?: OpenAPIParameter[]
    requestBody?: {
        content: Record<string, { schema?: OpenAPISchema }>
    }
    responses: Record<string, { description: string }>
}

interface OpenAPIDoc {
    openapi: "3.0.3"
    info: { title: string; version: string }
    servers: Array<{ url: string }>
    paths: Record<string, Record<string, OpenAPIOperation>>
    tags?: Array<{ name: string }>
}

const HEADERS_TO_SKIP = new Set([
    "content-type", "authorization", "accept", "accept-language", "accept-encoding",
    "cookie", "host", "user-agent", "connection", "cache-control",
])

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options"] as const

function inferSchema(v: unknown): OpenAPISchema {
    if (v === null) return { type: "string", example: null }
    if (typeof v === "string") return { type: "string", example: v }
    if (typeof v === "number") return { type: Number.isInteger(v) ? "integer" : "number", example: v }
    if (typeof v === "boolean") return { type: "boolean", example: v }
    if (Array.isArray(v)) {
        return {
            type: "array",
            items: v.length > 0 ? inferSchema(v[0]) : { type: "string" },
        }
    }
    if (typeof v === "object") {
        const props: Record<string, OpenAPISchema> = {}
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
            props[k] = inferSchema(val)
        }
        return { type: "object", properties: props }
    }
    return { type: "string" }
}

function* walkRequests(items: Array<CollectionFolder | CollectionRequest>, tag?: string): Generator<{ req: CollectionRequest; tag?: string }> {
    for (const item of items) {
        if ("type" in item && item.type === "folder") {
            yield* walkRequests(item.items, item.name)
        } else {
            yield { req: item as CollectionRequest, tag }
        }
    }
}

function pickCommonOrigin(reqs: CollectionRequest[]): string {
    const origins = new Map<string, number>()
    for (const r of reqs) {
        try {
            const u = new URL(r.url)
            const origin = `${u.protocol}//${u.host}`
            origins.set(origin, (origins.get(origin) ?? 0) + 1)
        } catch { /* skip bad URLs */ }
    }
    // The most-frequent origin wins; ties broken by first-seen (Map iteration order).
    let best: { origin: string; count: number } | null = null
    for (const [origin, count] of origins) {
        if (!best || count > best.count) best = { origin, count }
    }
    return best?.origin ?? ""
}

function pathOf(rawUrl: string, server: string): string {
    try {
        const u = new URL(rawUrl)
        const origin = `${u.protocol}//${u.host}`
        if (origin === server) return u.pathname || "/"
        return u.pathname || rawUrl
    } catch {
        // Treat as already a path-relative string.
        return rawUrl.startsWith("/") ? rawUrl : "/" + rawUrl
    }
}

function paramsToOpenApi(items: KeyValueItem[], where: "query" | "header"): OpenAPIParameter[] {
    return items
        .filter((it) => it.active && it.key)
        .filter((it) => where !== "header" || !HEADERS_TO_SKIP.has(it.key.toLowerCase()))
        .map((it) => ({
            name: it.key,
            in: where,
            schema: { type: "string", example: it.value || undefined },
        }))
}

function bodyToOpenApi(body: RequestBody): OpenAPIOperation["requestBody"] | undefined {
    if (!body || body.type === "none") return undefined

    if (body.type === "json") {
        try {
            const parsed = JSON.parse(body.content)
            return { content: { "application/json": { schema: inferSchema(parsed) } } }
        } catch {
            return { content: { "application/json": { schema: { type: "string" } } } }
        }
    }
    if (body.type === "x-www-form-urlencoded") {
        const props: Record<string, OpenAPISchema> = {}
        for (const it of body.urlEncoded ?? []) {
            if (it.active && it.key) props[it.key] = { type: "string", example: it.value || undefined }
        }
        return { content: { "application/x-www-form-urlencoded": { schema: { type: "object", properties: props } } } }
    }
    if (body.type === "form-data") {
        const props: Record<string, OpenAPISchema> = {}
        for (const it of body.formData ?? []) {
            if (it.active && it.key) {
                props[it.key] = it.valueType === "file"
                    ? { type: "string", example: it.fileName ?? "file" }
                    : { type: "string", example: it.value || undefined }
            }
        }
        return { content: { "multipart/form-data": { schema: { type: "object", properties: props } } } }
    }
    if (body.type === "graphql") {
        return { content: { "application/json": { schema: { type: "object", properties: { query: { type: "string" }, variables: { type: "object" } } } } } }
    }
    return { content: { "text/plain": { schema: { type: "string" } } } }
}

export function exportCollectionAsOpenApi(collection: Collection): OpenAPIDoc {
    const allRequests = [...walkRequests(collection.items)].map((x) => x.req)
    const server = pickCommonOrigin(allRequests)
    const paths: OpenAPIDoc["paths"] = {}
    const tagSet = new Set<string>()

    for (const { req, tag } of walkRequests(collection.items)) {
        const method = req.method.toLowerCase()
        if (!HTTP_METHODS.includes(method as typeof HTTP_METHODS[number])) continue
        const path = pathOf(req.url, server)
        paths[path] ??= {}
        const operation: OpenAPIOperation = {
            summary: req.name,
            tags: tag ? [tag] : undefined,
            parameters: [
                ...paramsToOpenApi(req.params, "query"),
                ...paramsToOpenApi(req.headers, "header"),
            ],
            requestBody: bodyToOpenApi(req.body),
            responses: { default: { description: "Default response" } },
        }
        if (tag) tagSet.add(tag)
        if (operation.parameters && operation.parameters.length === 0) delete operation.parameters
        paths[path][method] = operation
    }

    return {
        openapi: "3.0.3",
        info: { title: collection.name, version: "1.0.0" },
        servers: server ? [{ url: server }] : [],
        paths,
        tags: tagSet.size > 0 ? Array.from(tagSet).map((name) => ({ name })) : undefined,
    }
}

export function downloadCollectionAsOpenApi(collection: Collection): void {
    if (typeof window === "undefined") return
    const doc = exportCollectionAsOpenApi(collection)
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" })
    downloadFile(blob, `${collection.name.replace(/[^A-Za-z0-9_-]+/g, "_") || "openapi"}.openapi.json`)
}
