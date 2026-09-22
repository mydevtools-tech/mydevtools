"use client"

import * as React from "react"
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import dynamic from "next/dynamic"

const CodeEditor = dynamic(
    () => import("@/components/ui/code-editor"),
    { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-muted/30" /> }
)
const MemoCodeEditor = React.memo(CodeEditor)
import { ApiResponse, API_CLIENT_ERROR_STATUS_TEXT, ScriptLog, ScriptTestResult } from "./types"
import { JsonTreeView, JsonTableView, JsonGeoView } from "./json-visualisers"

function tryParseJson(text: string | undefined): unknown {
    if (!text) return null
    try { return JSON.parse(text) } catch { return null }
}
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { CheckCircle2, AlertCircle, Copy, Download, Search, Info, Clock, Database, Cookie, Bookmark } from "lucide-react"
import { cn } from "@/lib/utils"
import type { editor } from "monaco-editor"
import { truncateBody } from "./truncate-body"
import { ResponsePanelSkeleton } from "./skeletons"
import { downloadFile } from "@/lib/desktop/save-file"

const MAX_INLINE_BYTES = 2 * 1024 * 1024 // 2MB

const STATUS_COLOR: Record<string, string> = {
    success: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200",
    redirect: "bg-sky-100 text-sky-900 dark:bg-sky-950/60 dark:text-sky-200",
    clientError: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
    serverError: "bg-rose-100 text-rose-900 dark:bg-rose-950/60 dark:text-rose-200",
}

function getStatusColorKey(status: number): string {
    if (status >= 200 && status < 300) return "success"
    if (status >= 300 && status < 400) return "redirect"
    if (status >= 400 && status < 500) return "clientError"
    if (status >= 500) return "serverError"
    return "clientError"
}

interface ParsedCookie {
    name: string
    value: string
    path?: string
    domain?: string
    expires?: string
    maxAge?: string
    httpOnly?: boolean
    secure?: boolean
    sameSite?: string
}

function parseSetCookieHeaders(
    headers: Record<string, string>,
    setCookies?: string[],
): ParsedCookie[] {
    // Prefer the proxy's discrete list — header-map joins multiple Set-Cookie
    // with ", " which breaks on any cookie whose value contains a comma
    // (e.g. expires=Wed, 02-Jun-2027 …).
    const cookieStrings = (() => {
        if (setCookies && setCookies.length > 0) return setCookies
        const raw = Object.entries(headers).find(([k]) => k.toLowerCase() === "set-cookie")?.[1]
        if (!raw) return []
        return raw.split(/,(?=\s*[A-Za-z0-9_\-]+=)/g)
    })()
    return cookieStrings.flatMap(str => {
        const parts = str.split(";").map(s => s.trim())
        const nameValue = parts[0] ?? ""
        const eqIdx = nameValue.indexOf("=")
        const name = eqIdx >= 0 ? nameValue.slice(0, eqIdx).trim() : nameValue.trim()
        const value = eqIdx >= 0 ? nameValue.slice(eqIdx + 1) : ""
        if (!name) return []
        const cookie: ParsedCookie = { name, value }
        parts.slice(1).forEach(attr => {
            const lower = attr.toLowerCase()
            if (lower === "httponly") { cookie.httpOnly = true }
            else if (lower === "secure") { cookie.secure = true }
            else if (lower.startsWith("path=")) { cookie.path = attr.slice(5) }
            else if (lower.startsWith("domain=")) { cookie.domain = attr.slice(7) }
            else if (lower.startsWith("expires=")) { cookie.expires = attr.slice(8) }
            else if (lower.startsWith("max-age=")) { cookie.maxAge = attr.slice(8) }
            else if (lower.startsWith("samesite=")) { cookie.sameSite = attr.slice(9) }
        })
        return [cookie]
    })
}

function normalizeContentType(headers: Record<string, string>): string {
    const raw =
        Object.entries(headers).find(([k]) => k.toLowerCase() === "content-type")?.[1] || ""
    return raw.split(";")[0].trim().toLowerCase()
}

/** When servers omit or mislabel Content-Type, still offer an HTML preview for obvious documents. */
function bodyLooksLikeHtml(body: string): boolean {
    if (!body || body.length < 3) return false
    const s = body.trimStart()
    if (s.startsWith("<?xml")) return false
    if (/^\s*[{[]/.test(s)) return false
    const head = s.slice(0, 400)
    if (/^\s*<!doctype\s+html\b/i.test(head)) return true
    if (/^\s*<\s*html\b/i.test(head)) return true
    if (/^\s*<\s*(head|body)\b/i.test(head)) return true
    return false
}

interface ResponsePanelProps {
    response: ApiResponse | null
    isLoading?: boolean
    scriptResults?: {
        tests: ScriptTestResult[]
        logs: ScriptLog[]
        errors: string[]
    }
    /** When set, the toolbar shows a bookmark button that calls back to start the save-example flow. */
    onSaveExample?: () => void
}

function ResponsePanelImpl({ response, isLoading, scriptResults, onSaveExample }: ResponsePanelProps) {
    const t = useTranslations("ApiClient.responsePanel")
    const tApi = useTranslations("ApiClient")
    const { copyToClipboard } = useCopyToClipboard()
    const bodyEditorRef = React.useRef<editor.IStandaloneCodeEditor | null>(null)

    const handleOpenSearch = () => {
        bodyEditorRef.current?.getAction("actions.find")?.run()
    }

    // Slice the body passed to Monaco so the editor never receives >2MB of text.
    // Pretty-print (via the Worker) runs before this component renders, so slicing
    // happens on the already-formatted string. The full body is preserved on
    // response.body for download. MUST stay above the early returns below —
    // hooks cannot be called conditionally (React error #310).
    const { inline: inlineBody, truncated } = React.useMemo(
        () => truncateBody(response?.body ?? "", MAX_INLINE_BYTES),
        [response?.body]
    )
    // One parse per body for the tree/table/geo views — these used to parse
    // inline in JSX, three times per render, on every parent re-render.
    const parsedJson = React.useMemo(() => tryParseJson(response?.body), [response?.body])
    const handleEditorMount = React.useCallback((ed: editor.IStandaloneCodeEditor) => {
        bodyEditorRef.current = ed
    }, [])

    if (isLoading && !response) {
        return <ResponsePanelSkeleton />
    }
    if (!response) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-xl min-h-0 bg-muted/5 p-8 text-center space-y-4">
                <div className="h-12 w-12 rounded-full bg-muted/20 flex items-center justify-center">
                    <Search className="h-6 w-6 text-muted-foreground/50" />
                </div>
                <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
                    <p className="text-xs max-w-[200px]">{t("emptyHint")}</p>
                </div>
            </div>
        )
    }

    const isSuccess = response.status >= 200 && response.status < 300
    const isError = response.status >= 400

    const contentType = normalizeContentType(response.headers)
    const isHtmlByHeader =
        contentType.includes("text/html") ||
        contentType.includes("application/xhtml") ||
        contentType === "application/xhtml+xml"
    const isHtmlByBody = !response.isBase64 && bodyLooksLikeHtml(response.body)
    const isHtmlResponse = isHtmlByHeader || isHtmlByBody

    const getLanguage = () => {
        if (contentType.includes("json")) return "json"
        if (contentType.includes("html") || isHtmlByBody) return "html"
        if (contentType.includes("xml")) return "xml"
        return "text"
    }

    const handleCopy = () => {
        if (!response?.body) return
        void copyToClipboard(response.body, {
            successMessage: tApi("toasts.responseCopied"),
            errorMessage: tApi("toasts.copyFailed"),
        })
    }

    const handleDownload = () => {
        if (!response?.body) return
        let blob: Blob
        if (response.isBase64) {
            const binary = atob(response.body)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
            blob = new Blob([bytes], { type: contentType || "application/octet-stream" })
        } else {
            blob = new Blob([response.body], {
                type: contentType || (isHtmlResponse ? "text/html" : "text/plain"),
            })
        }
        downloadFile(blob, `response-${Date.now()}.${getLanguage()}`)
    }

    const renderPreview = () => {
        if (response.isBase64) {
            if (contentType.includes("image/")) {
                return (
                    <div className="flex items-center justify-center p-8 bg-muted/20 absolute inset-0 overflow-auto">
                        <img src={`data:${contentType};base64,${response.body}`} alt={t("responsePreviewAlt")} loading="lazy" decoding="async" className="max-w-full shadow-sm border" />
                    </div>
                )
            }
            if (contentType.includes("application/pdf")) {
                return (
                    <iframe src={`data:application/pdf;base64,${response.body}`} className="w-full h-full border-0 absolute inset-0" />
                )
            }
        } else if (isHtmlResponse) {
            return (
                <iframe
                    title="HTML response preview"
                    srcDoc={response.body}
                    className="w-full h-full min-h-[320px] border-0 absolute inset-0 bg-white dark:bg-background"
                    // `allow-same-origin` is omitted on purpose — combined with `srcDoc` it
                    // gives the framed page our origin and access to first-party storage/cookies.
                    sandbox="allow-popups allow-popups-to-escape-sandbox"
                />
            )
        }

        return (
            <div className="flex items-center justify-center p-8 absolute inset-0 text-muted-foreground">
                {t("previewUnavailable")}
            </div>
        )
    }

    const cookies = parseSetCookieHeaders(response.headers, response.setCookies)
    const redirectChain = response.redirectChain ?? []
    const hasPreview = response.isBase64 || isHtmlResponse
    const defaultTab = (isHtmlResponse && !response.isBase64) ||
          (response.isBase64 &&
              (contentType.includes("image/") || contentType.includes("application/pdf")))
            ? "preview"
            : "body"

    return (
        <div className="flex flex-col h-full space-y-4 min-h-0">
            <Tabs
                // Keying on status+time+size resets the active tab when a new response arrives.
                // body.length was previously included — that re-mounted Monaco on EVERY change
                // (worker-formatted body arrives milliseconds after the initial render), which
                // is expensive for >500KB responses. `value` prop alone updates Monaco's model.
                key={`${response.status}-${response.time}-${response.size}`}
                defaultValue={defaultTab}
                className="flex-1 flex flex-col min-h-0"
            >
                <div
                    className={cn(
                        "flex flex-wrap items-center justify-between gap-3 p-2 border rounded-xl bg-card shrink-0",
                        isSuccess ? "border-emerald-500/20 bg-emerald-500/[0.02]" : isError ? "border-rose-500/20 bg-rose-500/[0.02]" : ""
                    )}
                >
                    <TabsList className="h-9 p-1 bg-muted/50 border rounded-lg max-w-full overflow-x-auto custom-scrollbar [&>*]:shrink-0">
                        <TabsTrigger value="body" className="px-4">{t("bodyTab")}</TabsTrigger>
                        {hasPreview && <TabsTrigger value="preview" className="px-4">{t("previewTab")}</TabsTrigger>}
                        <TabsTrigger value="tree" className="px-4">Tree</TabsTrigger>
                        <TabsTrigger value="table" className="px-4">Table</TabsTrigger>
                        <TabsTrigger value="geo" className="px-4">Geo</TabsTrigger>
                        <TabsTrigger value="headers" className="px-4">{t("headersTab")}</TabsTrigger>
                        {cookies.length > 0 && (
                            <TabsTrigger value="cookies" className="px-4 flex items-center gap-1.5">
                                <Cookie className="h-3.5 w-3.5" />
                                Cookies
                                <span className="text-[10px] bg-primary/10 text-primary px-1 rounded">{cookies.length}</span>
                            </TabsTrigger>
                        )}
                        {scriptResults && (scriptResults.tests.length > 0 || scriptResults.logs.length > 0 || scriptResults.errors.length > 0) && (() => {
                            const failed = scriptResults.tests.filter(t => !t.pass).length
                            const passed = scriptResults.tests.length - failed
                            return (
                                <TabsTrigger value="tests" className="px-4 flex items-center gap-1.5">
                                    Tests
                                    {scriptResults.tests.length > 0 && (
                                        <span className={cn(
                                            "text-[10px] px-1 rounded",
                                            failed > 0
                                                ? "bg-rose-500/10 text-rose-500"
                                                : "bg-emerald-500/10 text-emerald-600",
                                        )}>
                                            {failed > 0 ? `${passed}/${scriptResults.tests.length}` : `${passed}`}
                                        </span>
                                    )}
                                </TabsTrigger>
                            )
                        })()}
                    </TabsList>
                    <div className="ml-auto flex items-center flex-wrap justify-end gap-2 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border bg-background/80 min-w-0">
                            {isSuccess ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                            ) : isError ? (
                                <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
                            ) : (
                                <Info className="h-3.5 w-3.5 text-blue-500" />
                            )}
                            <span className={cn(
                                "text-xs font-bold px-1 rounded shrink-0",
                                STATUS_COLOR[getStatusColorKey(response.status)]
                            )}>
                                {response.status}
                            </span>
                            <span className="text-xs text-muted-foreground hidden sm:inline truncate">
                                {response.statusText === API_CLIENT_ERROR_STATUS_TEXT
                                    ? t("errorStatusLabel")
                                    : response.statusText}
                            </span>
                        </div>
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border bg-background/80">
                            <Clock className="h-3.5 w-3.5 text-muted-foreground/70" />
                            <span className="text-xs font-mono font-semibold">{response.time}ms</span>
                        </div>
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border bg-background/80">
                            <Database className="h-3.5 w-3.5 text-muted-foreground/70" />
                            <span className="text-xs font-mono font-semibold">{(response.size / 1024).toFixed(2)} KB</span>
                        </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                        <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg" onClick={handleOpenSearch} title="Search in body (Ctrl+F)">
                            <Search className="h-4 w-4" />
                        </Button>
                        {onSaveExample && (
                            <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg" onClick={onSaveExample} title="Save response as example">
                                <Bookmark className="h-4 w-4" />
                            </Button>
                        )}
                        <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg" onClick={handleCopy} title={t("copyBody")}>
                            <Copy className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg" onClick={handleDownload} title={t("downloadResponse")}>
                            <Download className="h-4 w-4" />
                        </Button>
                        </div>
                    </div>
                </div>
                {redirectChain.length > 0 && (
                    <div
                        className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground"
                        title={redirectChain.map(h => `${h.status} → ${h.url}`).join("\n")}
                    >
                        <span className="font-semibold uppercase tracking-wider">Redirects:</span>
                        {redirectChain.map((hop, i) => (
                            <span key={`${hop.url}-${i}`} className="inline-flex items-center gap-1">
                                <span className="font-mono px-1 rounded bg-muted/50">{hop.status}</span>
                                <span className="font-mono break-all max-w-[40ch] truncate">{hop.url}</span>
                                <span className="opacity-60">→</span>
                            </span>
                        ))}
                    </div>
                )}
                <div className="mt-4 border rounded-xl overflow-hidden flex-1 min-h-0 relative shadow-inner bg-card">
                    <TabsContent value="body" className="mt-0 h-full absolute inset-0 flex flex-col">
                        {truncated && !response.isBase64 && (
                            <div className="flex items-center gap-2 px-3 py-2 text-xs bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 shrink-0">
                                <span className="text-amber-800 dark:text-amber-200 flex-1">
                                    {t("truncatedBanner", { shownKb: Math.round(MAX_INLINE_BYTES / 1024) })}
                                </span>
                                <Button size="sm" variant="link" className="h-auto p-0 text-xs text-amber-700 dark:text-amber-300" onClick={handleDownload}>
                                    {t("downloadFullBody")}
                                </Button>
                            </div>
                        )}
                        <div className="flex-1 min-h-0 relative">
                            <MemoCodeEditor
                                value={response.isBase64 ? t("binaryRawView") : inlineBody}
                                language={getLanguage()}
                                readOnly
                                onMount={handleEditorMount}
                            />
                        </div>
                    </TabsContent>
                    {hasPreview && (
                        <TabsContent value="preview" className="mt-0 h-full absolute inset-0">
                            {renderPreview()}
                        </TabsContent>
                    )}
                    <TabsContent value="tree" className="mt-0 h-full absolute inset-0 overflow-auto">
                        <JsonTreeView data={parsedJson} />
                    </TabsContent>
                    <TabsContent value="table" className="mt-0 h-full absolute inset-0 overflow-auto">
                        <JsonTableView rows={parsedJson} />
                    </TabsContent>
                    <TabsContent value="geo" className="mt-0 h-full absolute inset-0 overflow-auto">
                        <JsonGeoView data={parsedJson} />
                    </TabsContent>
                    <TabsContent value="headers" className="mt-0 h-full absolute inset-0">
                        <ScrollArea className="h-full">
                            <div className="p-4 space-y-2">
                                <div className="grid grid-cols-[auto,1fr] gap-x-6 gap-y-3">
                                    {Object.entries(response.headers).map(([key, value]) => (
                                        <React.Fragment key={key}>
                                            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70 py-1">{key}</div>
                                            <div className="text-xs font-mono break-all bg-muted/30 px-2 py-1 rounded border border-border/40 select-all">{value}</div>
                                        </React.Fragment>
                                    ))}
                                </div>
                            </div>
                        </ScrollArea>
                    </TabsContent>
                    {cookies.length > 0 && (
                        <TabsContent value="cookies" className="mt-0 h-full absolute inset-0">
                            <ScrollArea className="h-full">
                                <div className="p-4 space-y-3">
                                    {cookies.map((cookie, i) => (
                                        <div key={i} className="border rounded-lg p-3 bg-muted/20 space-y-2">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-xs font-bold text-foreground">{cookie.name}</span>
                                                <span className="text-xs font-mono text-muted-foreground break-all">{cookie.value}</span>
                                            </div>
                                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                                                {cookie.path && <span>Path: <code className="font-mono">{cookie.path}</code></span>}
                                                {cookie.domain && <span>Domain: <code className="font-mono">{cookie.domain}</code></span>}
                                                {cookie.expires && <span>Expires: {cookie.expires}</span>}
                                                {cookie.maxAge && <span>Max-Age: {cookie.maxAge}s</span>}
                                                {cookie.sameSite && <span>SameSite: {cookie.sameSite}</span>}
                                                {cookie.httpOnly && <span className="text-amber-600 font-medium">HttpOnly</span>}
                                                {cookie.secure && <span className="text-emerald-600 font-medium">Secure</span>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </TabsContent>
                    )}
                    {scriptResults && (scriptResults.tests.length > 0 || scriptResults.logs.length > 0 || scriptResults.errors.length > 0) && (
                        <TabsContent value="tests" className="mt-0 h-full absolute inset-0">
                            <ScrollArea className="h-full">
                                <div className="p-4 space-y-4">
                                    {scriptResults.errors.length > 0 && (
                                        <div className="border border-rose-500/30 bg-rose-500/5 rounded-lg p-3 space-y-1">
                                            <div className="text-xs font-bold uppercase tracking-wider text-rose-500">Script errors</div>
                                            {scriptResults.errors.map((err, i) => (
                                                <pre key={i} className="text-xs font-mono whitespace-pre-wrap break-all">{err}</pre>
                                            ))}
                                        </div>
                                    )}
                                    {scriptResults.tests.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Assertions</div>
                                            {scriptResults.tests.map((tt, i) => (
                                                <div
                                                    key={i}
                                                    className={cn(
                                                        "flex flex-col gap-1 border rounded-lg p-3 text-xs",
                                                        tt.pass
                                                            ? "border-emerald-500/20 bg-emerald-500/[0.03]"
                                                            : "border-rose-500/20 bg-rose-500/[0.03]",
                                                    )}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        {tt.pass ? (
                                                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                                        ) : (
                                                            <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
                                                        )}
                                                        <span className="font-medium break-all">{tt.name}</span>
                                                    </div>
                                                    {!tt.pass && tt.error && (
                                                        <pre className="font-mono text-rose-500 whitespace-pre-wrap break-all pl-5">
                                                            {tt.error}
                                                        </pre>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {scriptResults.logs.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Console</div>
                                            <div className="border rounded-lg p-3 bg-muted/20 space-y-1">
                                                {scriptResults.logs.map((l, i) => (
                                                    <div
                                                        key={i}
                                                        className={cn(
                                                            "text-xs font-mono whitespace-pre-wrap break-all",
                                                            l.level === "error" && "text-rose-500",
                                                            l.level === "warn" && "text-amber-600",
                                                        )}
                                                    >
                                                        {l.args.join(" ")}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </ScrollArea>
                        </TabsContent>
                    )}
                </div>
            </Tabs>
        </div>
    )
}

export const ResponsePanel = React.memo(ResponsePanelImpl)
