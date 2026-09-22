"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    IconFolder,
    IconTrash,
    IconDownload,
    IconUpload,
    IconFolderPlus,
    IconRefresh,
    IconChevronRight,
    IconArrowLeft,
    IconArrowUp,
    IconArrowDown,
    IconDots,
    IconSearch,
    IconCheck,
    IconLayoutGrid,
    IconLayoutList,
    IconEye,
    IconX,
    IconLoader2,
    IconHome,
    IconCloudUpload,
    IconPencil,
    IconCopy,
    IconLink,
    IconPackage,
    IconArrowsMove,
    IconShare,
    IconPlus,
} from "@tabler/icons-react"
import { listObjects, deleteObjects, getPresignedDownloadUrl, moveObject } from "@/lib/s3-drive-api"
import type { S3Credentials, S3ObjectItem } from "@/lib/s3-drive-api"
import { getObjectBlob, uploadFile } from "@/lib/s3-direct"
import { useS3DriveStore } from "@/store/s3-drive-store"
import { CreateFolderDialog } from "./create-folder-dialog"
import { formatBytes, moveFolderRecursive } from "./utils"
import { getFileType, isPreviewable, TYPE_BG_CLASS, TYPE_LABEL } from "./file-types"
import { FileIconComp } from "./file-icon"
import { Checkbox, isCheckboxClick } from "./checkbox"
import { FilePreviewDialog, type PreviewState } from "./file-preview-dialog"
import { RenameDialog } from "./rename-dialog"
import { ShareLinkDialog } from "./share-link-dialog"
import { UploadProgressPanel, type FileUploadStatus } from "./upload-progress-panel"
import { MoveToDialog } from "./move-to-dialog"
import { downloadFile } from "@/lib/desktop/save-file"

type ViewMode = "list" | "grid"
type SortCol = "name" | "size" | "modified"
type SortDir = "asc" | "desc"
type RenameTarget = { key: string; isFolder: boolean; displayName: string }


// ── File preview dialog ───────────────────────────────────────────────────────
// ── Sort header ───────────────────────────────────────────────────────────────

function SortHeader({
    col, label, current, dir, onSort, className,
}: {
    col: SortCol; label: string; current: SortCol; dir: SortDir
    onSort: (col: SortCol) => void; className?: string
}) {
    const active = current === col
    return (
        <th
            className={cn(
                "px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider border-b cursor-pointer select-none transition-colors group/th",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                className,
            )}
            onClick={() => onSort(col)}
        >
            <span className="flex items-center gap-1">
                {label}
                {active
                    ? dir === "asc"
                        ? <IconArrowUp className="size-3 shrink-0" />
                        : <IconArrowDown className="size-3 shrink-0" />
                    : <IconArrowUp className="size-3 shrink-0 opacity-0 group-hover/th:opacity-30" />
                }
            </span>
        </th>
    )
}

// ── Context menu wrapper ──────────────────────────────────────────────────────

type ItemActionProps = {
    isFolder: boolean
    isPreviewable: boolean
    onNavigate: (() => void) | null
    onPreview?: () => void
    onDownload: () => void
    onDelete: () => void
    onRename: () => void
    onMoveOpen: () => void
    onCopyPath: () => void
    onCopyLink: (() => void) | null
    onShareLink: (() => void) | null
}

function WithContextMenu({ children, ...actions }: { children: React.ReactNode } & ItemActionProps) {
    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
            <ContextMenuContent className="w-44">
                {actions.isFolder && actions.onNavigate && (
                    <ContextMenuItem onClick={actions.onNavigate}>
                        <IconChevronRight className="size-4 mr-2" /> Open
                    </ContextMenuItem>
                )}
                {actions.isPreviewable && actions.onPreview && (
                    <ContextMenuItem onClick={actions.onPreview}>
                        <IconEye className="size-4 mr-2" /> Preview
                    </ContextMenuItem>
                )}
                {!actions.isFolder && (
                    <ContextMenuItem onClick={actions.onDownload}>
                        <IconDownload className="size-4 mr-2" /> Download
                    </ContextMenuItem>
                )}
                <ContextMenuItem onClick={actions.onRename}>
                    <IconPencil className="size-4 mr-2" /> Rename
                </ContextMenuItem>
                <ContextMenuItem onClick={actions.onMoveOpen}>
                    <IconArrowsMove className="size-4 mr-2" /> Move to…
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={actions.onCopyPath}>
                    <IconCopy className="size-4 mr-2" /> Copy S3 path
                </ContextMenuItem>
                {actions.onCopyLink && (
                    <ContextMenuItem onClick={actions.onCopyLink}>
                        <IconLink className="size-4 mr-2" /> Copy link
                    </ContextMenuItem>
                )}
                {actions.onShareLink && (
                    <ContextMenuItem onClick={actions.onShareLink}>
                        <IconShare className="size-4 mr-2" /> Share link…
                    </ContextMenuItem>
                )}
                <ContextMenuSeparator />
                <ContextMenuItem className="text-destructive focus:text-destructive" onClick={actions.onDelete}>
                    <IconTrash className="size-4 mr-2" /> Delete
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    )
}

// ── Infinite load sentinel ────────────────────────────────────────────────────

function InfiniteLoadSentinel({ onVisible, loading }: { onVisible: () => void; loading: boolean }) {
    const ref = useRef<HTMLDivElement>(null)
    const onVisibleRef = useRef(onVisible)
    const loadingRef = useRef(loading)
    onVisibleRef.current = onVisible
    loadingRef.current = loading

    useEffect(() => {
        const el = ref.current
        if (!el) return
        const obs = new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting && !loadingRef.current) onVisibleRef.current()
        }, { rootMargin: "300px 0px" })
        obs.observe(el)
        return () => obs.disconnect()
    }, [])

    return (
        <div ref={ref} className="flex justify-center items-center py-5 text-xs text-muted-foreground gap-2">
            {loading ? <><IconLoader2 className="size-3.5 animate-spin" /> Loading more…</> : <span className="opacity-60">Scroll for more</span>}
        </div>
    )
}

// ── FileBrowser ───────────────────────────────────────────────────────────────

type Props = { credentials: S3Credentials; connectionName: string }

export function FileBrowser({ credentials, connectionName }: Props) {
    const {
        currentPrefix, objects, prefixes, isLoading, isTruncated, nextContinuationToken,
        selectedKeys, setCurrentPrefix, setObjects, setLoading,
        toggleSelectKey, clearSelection, selectAll,
    } = useS3DriveStore()

    const { copyToClipboard } = useCopyToClipboard()
    const [viewMode, setViewMode] = useState<ViewMode>("list")
    const [search, setSearch] = useState("")
    const [debouncedSearch, setDebouncedSearch] = useState("")
    const [sortCol, setSortCol] = useState<SortCol>("name")
    const [sortDir, setSortDir] = useState<SortDir>("asc")
    const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
    const [createFolderOpen, setCreateFolderOpen] = useState(false)
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [uploadQueue, setUploadQueue] = useState<FileUploadStatus[]>([])
    const uploadQueueRef = useRef<FileUploadStatus[]>([])
    useEffect(() => { uploadQueueRef.current = uploadQueue }, [uploadQueue])
    const [uploadPanelOpen, setUploadPanelOpen] = useState(false)
    const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null)
    const [preview, setPreview] = useState<PreviewState | null>(null)
    const [isDragOver, setIsDragOver] = useState(false)
    const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
    const [moveItems, setMoveItems] = useState<{ key: string; isFolder: boolean }[] | null>(null)
    const [shareLinkTarget, setShareLinkTarget] = useState<string | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const dropZoneRef = useRef<HTMLDivElement>(null)

    const loadObjects = useCallback(async (prefix: string, token?: string) => {
        setLoading(true)
        try {
            const res = await listObjects(credentials, prefix, token)
            if (token) {
                const s = useS3DriveStore.getState()
                setObjects([...s.objects, ...res.objects], [...s.prefixes, ...res.prefixes], res.isTruncated, res.nextContinuationToken)
            } else {
                setObjects(res.objects, res.prefixes, res.isTruncated, res.nextContinuationToken)
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to list objects")
        } finally {
            setLoading(false)
        }
    }, [credentials, setLoading, setObjects])

    useEffect(() => { loadObjects(currentPrefix) }, [currentPrefix]) // eslint-disable-line react-hooks/exhaustive-deps

    // Debounce search to avoid re-sort on every keystroke
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search), 200)
        return () => clearTimeout(t)
    }, [search])

    // Reset focus when navigating
    useEffect(() => { setFocusedIndex(null) }, [currentPrefix, debouncedSearch])

    // Sorted + filtered lists (memoized — recompute only when inputs change)
    const sortedPrefixes = useMemo(() => {
        const q = debouncedSearch.toLowerCase()
        const filtered = q ? prefixes.filter((p) => p.toLowerCase().includes(q)) : prefixes
        return [...filtered].sort((a, b) => {
            const an = a.replace(currentPrefix, "").replace(/\/$/, "").toLowerCase()
            const bn = b.replace(currentPrefix, "").replace(/\/$/, "").toLowerCase()
            return sortDir === "asc" ? an.localeCompare(bn) : bn.localeCompare(an)
        })
    }, [prefixes, debouncedSearch, currentPrefix, sortDir])

    const sortedObjects = useMemo(() => {
        const q = debouncedSearch.toLowerCase()
        const filtered = q ? objects.filter((o) => o.key.toLowerCase().includes(q)) : objects
        return [...filtered].sort((a, b) => {
            let cmp = 0
            if (sortCol === "name") {
                cmp = a.key.replace(currentPrefix, "").toLowerCase()
                    .localeCompare(b.key.replace(currentPrefix, "").toLowerCase())
            } else if (sortCol === "size") {
                cmp = (a.size ?? 0) - (b.size ?? 0)
            } else if (sortCol === "modified") {
                cmp = (a.lastModified ?? "").localeCompare(b.lastModified ?? "")
            }
            return sortDir === "asc" ? cmp : -cmp
        })
    }, [objects, debouncedSearch, currentPrefix, sortCol, sortDir])

    const allItems = useMemo(
        () => [...sortedPrefixes, ...sortedObjects.map((o) => o.key)],
        [sortedPrefixes, sortedObjects],
    )

    // Keyboard shortcuts
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            const tag = (e.target as HTMLElement).tagName
            if (tag === "INPUT" || tag === "TEXTAREA") return

            const total = allItems.length

            if (e.key === "ArrowDown") {
                e.preventDefault()
                setFocusedIndex((i) => i === null ? 0 : Math.min(i + 1, total - 1))
            } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setFocusedIndex((i) => i === null ? total - 1 : Math.max(i - 1, 0))
            } else if (e.key === "Enter" && focusedIndex !== null) {
                const key = allItems[focusedIndex]
                if (!key) return
                if (key.endsWith("/")) { clearSelection(); setCurrentPrefix(key) }
                else {
                    const type = getFileType(key.replace(currentPrefix, ""))
                    if (isPreviewable(type)) openPreview(key)
                    else onDownload(key)
                }
            } else if (e.key === " " && focusedIndex !== null) {
                e.preventDefault()
                const key = allItems[focusedIndex]
                if (key) toggleSelectKey(key)
            } else if (e.key === "Escape") {
                if (selectedKeys.size > 0) clearSelection()
                else setFocusedIndex(null)
            } else if ((e.key === "Delete" || e.key === "Backspace") && selectedKeys.size > 0 && !deleteConfirmOpen) {
                e.preventDefault()
                setDeleteConfirmOpen(true)
            }
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allItems, focusedIndex, selectedKeys.size, deleteConfirmOpen, currentPrefix])

    // Scroll focused row into view
    useEffect(() => {
        if (focusedIndex === null) return
        document.querySelector("[data-focused-row]")?.scrollIntoView({ block: "nearest" })
    }, [focusedIndex])

    function navigateInto(prefix: string) { clearSelection(); setCurrentPrefix(prefix) }
    function navigateUp() {
        if (!currentPrefix) return
        const parts = currentPrefix.replace(/\/$/, "").split("/")
        parts.pop()
        setCurrentPrefix(parts.length ? parts.join("/") + "/" : "")
    }

    function toggleSort(col: SortCol) {
        if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc")
        else { setSortCol(col); setSortDir("asc") }
    }

    async function onDownload(key: string) {
        try {
            // Fetched through the Rust proxy — a cross-origin presigned URL would
            // hit CORS / unsupported downloads in the Tauri webview.
            const blob = await getObjectBlob(credentials, key)
            downloadFile(blob, key.split("/").pop() ?? key)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to download file")
        }
    }

    async function openPreview(key: string) {
        const name = key.split("/").pop() ?? key
        const fileType = getFileType(name)
        setPreview({ key, url: null, loading: true, fileType })
        try {
            const { url } = await getPresignedDownloadUrl(credentials, key)
            if (fileType === "code" || fileType === "doc") {
                // webview fetch() of the presigned URL would hit CORS — go via Rust proxy
                const blob = await getObjectBlob(credentials, key, { headers: { Range: "bytes=0-204799" } })
                setPreview({ key, url, loading: false, fileType, textContent: await blob.text() })
            } else {
                setPreview({ key, url, loading: false, fileType })
            }
        } catch {
            setPreview({ key, url: null, loading: false, fileType })
        }
    }

    async function onDelete() {
        if (selectedKeys.size === 0) return
        setDeleting(true)
        try {
            const keys = Array.from(selectedKeys)
            await deleteObjects(credentials, keys)
            toast.success(`Deleted ${keys.length} item${keys.length > 1 ? "s" : ""}`)
            clearSelection()
            loadObjects(currentPrefix)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to delete")
        } finally {
            setDeleting(false)
            setDeleteConfirmOpen(false)
        }
    }

    const updateFileRef = useRef<(idx: number, update: Partial<FileUploadStatus>) => void>(() => {})
    updateFileRef.current = (idx, update) =>
        setUploadQueue((prev) => prev.map((f, j) => (j === idx ? { ...f, ...update } : f)))

    const uploadOneRef = useRef<(idx: number) => Promise<boolean>>(async () => false)
    uploadOneRef.current = async (idx: number): Promise<boolean> => {
        const entry = uploadQueueRef.current[idx]
        if (!entry?.file || !entry.key) return false
        updateFileRef.current(idx, { status: "uploading", progress: 0, error: undefined })
        try {
            await uploadFile(credentials, entry.key, entry.file, (p) => updateFileRef.current(idx, { progress: p }))
            updateFileRef.current(idx, { status: "done", progress: 1 })
            return true
        } catch (err) {
            updateFileRef.current(idx, { status: "error", error: err instanceof Error ? err.message : "Upload failed" })
            return false
        }
    }

    async function onUploadFiles(files: FileList | File[]) {
        const arr = Array.from(files)
        if (!arr.length) return

        let startIdx = 0
        setUploadQueue((prev) => {
            startIdx = prev.length
            const additions: FileUploadStatus[] = arr.map((f) => ({
                name: f.name,
                status: "queued",
                progress: 0,
                file: f,
                key: `${currentPrefix}${f.name}`,
            }))
            return [...prev, ...additions]
        })
        setUploadPanelOpen(true)

        const CONCURRENCY = 4
        let successCount = 0

        for (let i = 0; i < arr.length; i += CONCURRENCY) {
            const indices = arr.slice(i, i + CONCURRENCY).map((_, j) => startIdx + i + j)
            const results = await Promise.allSettled(indices.map((idx) => uploadOneRef.current(idx)))
            successCount += results.filter((r) => r.status === "fulfilled" && r.value).length
        }

        if (successCount > 0) {
            toast.success(`Uploaded ${successCount} file${successCount > 1 ? "s" : ""}`)
            loadObjects(currentPrefix)
        }
        if (successCount < arr.length) {
            toast.error(`${arr.length - successCount} file${arr.length - successCount > 1 ? "s" : ""} failed — retry from panel`)
        }
    }

    async function retryUpload(idx: number) {
        const ok = await uploadOneRef.current(idx)
        if (ok) loadObjects(currentPrefix)
    }

    async function retryAllFailed() {
        const failedIndices = uploadQueueRef.current
            .map((f, i) => (f.status === "error" ? i : -1))
            .filter((i) => i !== -1)
        if (!failedIndices.length) return
        const CONCURRENCY = 4
        let ok = 0
        for (let i = 0; i < failedIndices.length; i += CONCURRENCY) {
            const batch = failedIndices.slice(i, i + CONCURRENCY)
            const results = await Promise.allSettled(batch.map((idx) => uploadOneRef.current(idx)))
            ok += results.filter((r) => r.status === "fulfilled" && r.value).length
        }
        if (ok > 0) loadObjects(currentPrefix)
    }

    async function onDownloadZip() {
        const fileKeys = Array.from(selectedKeys).filter((k) => !k.endsWith("/"))
        if (!fileKeys.length) { toast.error("No files selected (folders are skipped)"); return }
        setZipProgress({ done: 0, total: fileKeys.length })
        const { default: JSZip } = await import("jszip")
        const zip = new JSZip()
        let ok = 0
        const ZIP_CONCURRENCY = 6
        async function fetchOne(key: string) {
            try {
                // presigned + fetched via the Rust proxy (webview fetch hits CORS)
                const blob = await getObjectBlob(credentials, key)
                zip.file(key.split("/").pop() ?? key, blob)
                ok++
                setZipProgress({ done: ok, total: fileKeys.length })
            } catch {
                toast.error(`Failed to fetch ${key.split("/").pop()}`)
            }
        }
        for (let i = 0; i < fileKeys.length; i += ZIP_CONCURRENCY) {
            const batch = fileKeys.slice(i, i + ZIP_CONCURRENCY)
            await Promise.allSettled(batch.map(fetchOne))
        }
        if (ok > 0) {
            const blob = await zip.generateAsync({ type: "blob" })
            downloadFile(blob, `download-${Date.now()}.zip`)
        }
        setZipProgress(null)
    }

    function onCopyS3Path(key: string) {
        void copyToClipboard(`s3://${credentials.bucket}/${key}`, "Copied S3 path")
    }

    async function onCopyLink(key: string) {
        try {
            const { url } = await getPresignedDownloadUrl(credentials, key)
            void copyToClipboard(url, "Copied link")
        } catch {
            toast.error("Failed to copy link")
        }
    }

    async function onRename(newName: string) {
        if (!renameTarget) return
        try {
            if (renameTarget.isFolder) {
                const newPrefix = currentPrefix + newName + "/"
                await renameFolderRecursive(renameTarget.key, newPrefix)
            } else {
                await moveObject(credentials, renameTarget.key, currentPrefix + newName)
            }
            toast.success("Renamed")
            loadObjects(currentPrefix)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Rename failed")
            throw err
        }
    }

    async function renameFolderRecursive(oldPrefix: string, newPrefix: string) {
        await moveFolderRecursive(credentials, oldPrefix, newPrefix)
    }

    // Drag-and-drop
    function onDragOver(e: React.DragEvent) {
        e.preventDefault(); e.stopPropagation()
        if (e.dataTransfer.types.includes("Files")) setIsDragOver(true)
    }
    function onDragLeave(e: React.DragEvent) {
        if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) setIsDragOver(false)
    }
    function onDrop(e: React.DragEvent) {
        e.preventDefault(); e.stopPropagation()
        setIsDragOver(false)
        if (e.dataTransfer.files.length) onUploadFiles(e.dataTransfer.files)
    }

    // Breadcrumb
    const breadcrumbs = currentPrefix ? currentPrefix.replace(/\/$/, "").split("/") : []
    const COLLAPSE_AT = 4

    function renderCrumb(part: string, index: number, prefixOverride?: string) {
        const prefix = prefixOverride ?? (breadcrumbs.slice(0, index + 1).join("/") + "/")
        const isLast = index === breadcrumbs.length - 1
        return (
            <span key={prefix} className="flex items-center min-w-0 shrink-0">
                <IconChevronRight className="size-3.5 text-muted-foreground/40 mx-0.5 shrink-0" />
                <button
                    onClick={() => { clearSelection(); setCurrentPrefix(prefix) }}
                    className={cn(
                        "px-2 py-1 rounded-md hover:bg-muted transition-colors truncate text-xs",
                        isLast ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
                    )}
                >
                    {part}
                </button>
            </span>
        )
    }

    const allCount = sortedPrefixes.length + sortedObjects.length
    const allSelected = allCount > 0 && selectedKeys.size >= allCount
    const someSelected = selectedKeys.size > 0 && !allSelected
    const hasSelection = selectedKeys.size > 0
    const selectedFileCount = Array.from(selectedKeys).filter((k) => !k.endsWith("/")).length

    const sharedProps: SharedProps = {
        filteredPrefixes: sortedPrefixes,
        filteredObjects: sortedObjects,
        currentPrefix, selectedKeys, hasSelection,
        onToggleKey: toggleSelectKey,
        onNavigateInto: navigateInto,
        onDownload,
        onOpenPreview: openPreview,
        onDeleteSingle: (key: string) => {
            if (!selectedKeys.has(key)) toggleSelectKey(key)
            setDeleteConfirmOpen(true)
        },
        onCopyS3Path,
        onCopyLink,
        onRenameOpen: (key, isFolder, displayName) => setRenameTarget({ key, isFolder, displayName }),
        onMoveOpen: (items) => setMoveItems(items),
        onShareLinkOpen: (key) => setShareLinkTarget(key),
    }

    return (
        <div
            ref={dropZoneRef}
            className="flex flex-col h-full bg-background relative"
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            {isDragOver && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-blue-50/80 dark:bg-blue-950/70 backdrop-blur-md border-2 border-dashed border-blue-400/60 dark:border-blue-500/50 pointer-events-none">
                    <div className="relative">
                        <div className="absolute inset-0 rounded-full bg-blue-500/20 blur-xl animate-pulse" />
                        <div className="relative size-20 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-300/30 dark:border-blue-600/30">
                            <IconCloudUpload className="size-10 text-blue-500 animate-bounce" />
                        </div>
                    </div>
                    <div className="text-center space-y-1">
                        <p className="text-base font-semibold text-blue-700 dark:text-blue-300">Drop files to upload</p>
                        <p className="text-sm text-blue-500/70">Files will be uploaded to the current folder</p>
                    </div>
                </div>
            )}

            {/* Toolbar */}
            <div className="flex items-center gap-1.5 px-3 py-2.5 border-b shrink-0 relative bg-background/80 backdrop-blur-sm">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button size="icon" variant="ghost" className="size-8 text-muted-foreground shrink-0" onClick={navigateUp} disabled={!currentPrefix || isLoading}>
                            <IconArrowLeft className="size-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Go up</TooltipContent>
                </Tooltip>

                {/* Breadcrumb with overflow */}
                <nav className="flex items-center min-w-0 flex-1 overflow-hidden">
                    <button
                        onClick={() => { clearSelection(); setCurrentPrefix("") }}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0 text-sm"
                    >
                        <IconHome className="size-3.5" />
                        <span className="font-medium text-xs">{connectionName}</span>
                    </button>

                    {breadcrumbs.length > 0 && (
                        breadcrumbs.length < COLLAPSE_AT
                            ? breadcrumbs.map((part, i) => renderCrumb(part, i))
                            : (
                                <>
                                    {renderCrumb(breadcrumbs[0], 0)}
                                    <span className="flex items-center shrink-0">
                                        <IconChevronRight className="size-3.5 text-muted-foreground/40 mx-0.5 shrink-0" />
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <button className="px-1.5 py-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                                                    <IconDots className="size-3.5" />
                                                </button>
                                            </PopoverTrigger>
                                            <PopoverContent align="start" className="w-auto p-1" sideOffset={6}>
                                                {breadcrumbs.slice(1, -2).map((part, i) => {
                                                    const prefix = breadcrumbs.slice(0, i + 2).join("/") + "/"
                                                    return (
                                                        <button
                                                            key={prefix}
                                                            onClick={() => { clearSelection(); setCurrentPrefix(prefix) }}
                                                            className="flex w-full items-center gap-2 px-3 py-1.5 rounded-sm hover:bg-muted text-xs text-left"
                                                        >
                                                            <IconFolder className="size-3.5 text-muted-foreground shrink-0" />
                                                            {part}
                                                        </button>
                                                    )
                                                })}
                                            </PopoverContent>
                                        </Popover>
                                    </span>
                                    {breadcrumbs.slice(-2).map((part, idx) => {
                                        const i = breadcrumbs.length - 2 + idx
                                        return renderCrumb(part, i)
                                    })}
                                </>
                            )
                    )}
                </nav>

                {/* Search */}
                <div className="relative shrink-0">
                    <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                        className="h-8 pl-8 pr-7 w-44 text-xs bg-muted/60 border-0 focus-visible:ring-1 rounded-lg"
                        placeholder="Search in folder…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                        <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setSearch("")}>
                            <IconX className="size-3.5" />
                        </button>
                    )}
                </div>

                <Separator orientation="vertical" className="h-5 mx-1" />

                <div className="flex items-center bg-muted rounded-lg p-0.5 shrink-0">
                    <Button size="icon" variant="ghost" className={cn("size-7 rounded-md transition-all", viewMode === "list" && "bg-background shadow-sm text-foreground")} onClick={() => setViewMode("list")}>
                        <IconLayoutList className="size-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className={cn("size-7 rounded-md transition-all", viewMode === "grid" && "bg-background shadow-sm text-foreground")} onClick={() => setViewMode("grid")}>
                        <IconLayoutGrid className="size-4" />
                    </Button>
                </div>

                <Separator orientation="vertical" className="h-5 mx-1" />

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button size="icon" variant="ghost" className="size-8 text-muted-foreground shrink-0" onClick={() => loadObjects(currentPrefix)} disabled={isLoading}>
                            <IconRefresh className={cn("size-4", isLoading && "animate-spin")} />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Refresh</TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button size="icon" variant="ghost" className="size-8 text-muted-foreground shrink-0" onClick={() => setCreateFolderOpen(true)}>
                            <IconFolderPlus className="size-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>New folder</TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button size="icon" variant="ghost" className="size-8 text-muted-foreground shrink-0" onClick={() => fileInputRef.current?.click()}>
                            <IconUpload className="size-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Upload files</TooltipContent>
                </Tooltip>

                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && onUploadFiles(e.target.files)} />

                {/* Zip progress bar */}
                {zipProgress && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-muted">
                        <div
                            className="h-full bg-blue-500 transition-[width] duration-300 ease-out"
                            style={{ width: `${(zipProgress.done / zipProgress.total) * 100}%` }}
                        />
                    </div>
                )}
            </div>

            {/* Content */}
            <ScrollArea className="flex-1">
                {isLoading && allCount === 0 ? (
                    <div className="flex flex-col items-center justify-center h-56 gap-3 text-muted-foreground">
                        <div className="relative">
                            <div className="absolute inset-0 rounded-full bg-primary/10 blur-lg animate-pulse" />
                            <IconLoader2 className="relative size-7 animate-spin" />
                        </div>
                        <p className="text-sm">Loading…</p>
                    </div>
                ) : allCount === 0 ? (
                    <div
                        className="flex flex-col items-center justify-center h-full min-h-64 gap-4 text-muted-foreground cursor-pointer select-none group/empty"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <div className="relative">
                            <div className="size-24 rounded-3xl bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center border border-border/30 transition-transform duration-300 group-hover/empty:scale-105">
                                <IconCloudUpload className="size-11 opacity-30 transition-opacity group-hover/empty:opacity-50" />
                            </div>
                            <div className="absolute -bottom-1 -right-1 size-8 rounded-xl bg-primary/10 flex items-center justify-center ring-3 ring-background">
                                <IconPlus className="size-3.5 text-primary/60" />
                            </div>
                        </div>
                        <div className="text-center space-y-1">
                            <p className="text-sm font-medium text-foreground/60">This folder is empty</p>
                            <p className="text-xs opacity-50">Drop files or click to upload</p>
                        </div>
                    </div>
                ) : viewMode === "list" ? (
                    <ListView
                        {...sharedProps}
                        allSelected={allSelected}
                        someSelected={someSelected}
                        onSelectAll={allSelected ? clearSelection : selectAll}
                        sortCol={sortCol}
                        sortDir={sortDir}
                        onSort={toggleSort}
                        focusedIndex={focusedIndex}
                        onFocusRow={(i) => setFocusedIndex(i)}
                    />
                ) : (
                    <GridView {...sharedProps} />
                )}

                {isTruncated && (
                    <InfiniteLoadSentinel
                        onVisible={() => loadObjects(currentPrefix, nextContinuationToken)}
                        loading={isLoading}
                    />
                )}
            </ScrollArea>

            {/* Selection bar */}
            {hasSelection && (
                <div className="flex items-center gap-3 px-4 py-2.5 border-t border-blue-200/50 dark:border-blue-800/50 bg-blue-50/90 dark:bg-blue-950/40 backdrop-blur-sm shrink-0 animate-in slide-in-from-bottom-2 duration-200">
                    <Checkbox
                        checked={allSelected}
                        indeterminate={someSelected}
                        onToggle={() => allSelected ? clearSelection() : selectAll()}
                    />
                    <span className="text-sm font-medium text-blue-700 dark:text-blue-300 flex-1">
                        {selectedKeys.size} selected
                        <span className="ml-2 text-blue-500/60 font-normal text-[11px] hidden sm:inline">Esc to deselect · Del to delete</span>
                    </span>
                    <div className="flex items-center gap-1.5">
                        {selectedFileCount > 1 ? (
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1.5 border-blue-200/60 dark:border-blue-800/60 bg-white/50 dark:bg-white/5 hover:bg-blue-100 dark:hover:bg-blue-900 rounded-lg"
                                onClick={onDownloadZip}
                                disabled={!!zipProgress}
                            >
                                <IconPackage className="size-3.5" />
                                {zipProgress ? `${zipProgress.done}/${zipProgress.total}` : "Download ZIP"}
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1.5 border-blue-200/60 dark:border-blue-800/60 bg-white/50 dark:bg-white/5 hover:bg-blue-100 dark:hover:bg-blue-900 rounded-lg"
                                onClick={() => Array.from(selectedKeys).filter((k) => !k.endsWith("/")).forEach((k) => onDownload(k))}
                            >
                                <IconDownload className="size-3.5" /> Download
                            </Button>
                        )}
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1.5 border-blue-200/60 dark:border-blue-800/60 bg-white/50 dark:bg-white/5 hover:bg-blue-100 dark:hover:bg-blue-900 rounded-lg"
                            onClick={() => setMoveItems(Array.from(selectedKeys).map((k) => ({ key: k, isFolder: k.endsWith("/") })))}
                        >
                            <IconArrowsMove className="size-3.5" /> Move
                        </Button>
                        <Button size="sm" variant="destructive" className="h-7 text-xs gap-1.5 rounded-lg shadow-sm" onClick={() => setDeleteConfirmOpen(true)} disabled={deleting}>
                            <IconTrash className="size-3.5" /> Delete
                        </Button>
                        <Button size="icon" variant="ghost" className="size-7 text-blue-500/60 hover:text-blue-600 rounded-lg" onClick={clearSelection}>
                            <IconX className="size-4" />
                        </Button>
                    </div>
                </div>
            )}

            {/* Status bar */}
            {!hasSelection && allCount > 0 && (
                <div className="flex items-center gap-3 px-4 py-1.5 border-t text-[11px] text-muted-foreground/60 shrink-0 bg-muted/20">
                    <span>{sortedPrefixes.length + sortedObjects.length} items</span>
                    {sortedPrefixes.length > 0 && <span>· {sortedPrefixes.length} folder{sortedPrefixes.length !== 1 ? "s" : ""}</span>}
                    {sortedObjects.length > 0 && <span>· {sortedObjects.length} file{sortedObjects.length !== 1 ? "s" : ""}</span>}
                    {currentPrefix && <span className="ml-auto font-mono text-[10px] truncate max-w-xs">/{currentPrefix.replace(/\/$/, "")}</span>}
                </div>
            )}

            {/* Dialogs */}
            <CreateFolderDialog
                open={createFolderOpen}
                onClose={() => setCreateFolderOpen(false)}
                credentials={credentials}
                currentPrefix={currentPrefix}
                onCreated={() => loadObjects(currentPrefix)}
            />
            <AlertDialog open={deleteConfirmOpen} onOpenChange={(o) => !o && setDeleteConfirmOpen(false)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete {selectedKeys.size} item{selectedKeys.size > 1 ? "s" : ""}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Permanently deletes the selected files and folders from S3. This cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={onDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            {deleting ? "Deleting…" : "Delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <FilePreviewDialog preview={preview} onClose={() => setPreview(null)} onDownload={onDownload} />
            <RenameDialog
                open={!!renameTarget}
                initialName={renameTarget?.displayName ?? ""}
                onClose={() => setRenameTarget(null)}
                onRename={onRename}
            />
            <MoveToDialog
                open={!!moveItems}
                items={moveItems ?? []}
                credentials={credentials}
                currentPrefix={currentPrefix}
                onClose={() => setMoveItems(null)}
                onMoved={() => { clearSelection(); loadObjects(currentPrefix) }}
            />
            <ShareLinkDialog
                open={!!shareLinkTarget}
                fileKey={shareLinkTarget}
                credentials={credentials}
                onClose={() => setShareLinkTarget(null)}
            />
            {uploadPanelOpen && (
                <UploadProgressPanel
                    queue={uploadQueue}
                    onClearCompleted={() => setUploadQueue([])}
                    onDismiss={() => setUploadPanelOpen(false)}
                    onRetry={retryUpload}
                    onRetryAll={retryAllFailed}
                />
            )}
        </div>
    )
}

// ── Shared props ──────────────────────────────────────────────────────────────

type SharedProps = {
    filteredPrefixes: string[]
    filteredObjects: S3ObjectItem[]
    currentPrefix: string
    selectedKeys: Set<string>
    hasSelection: boolean
    onToggleKey: (key: string) => void
    onNavigateInto: (prefix: string) => void
    onDownload: (key: string) => void
    onOpenPreview: (key: string) => void
    onDeleteSingle: (key: string) => void
    onCopyS3Path: (key: string) => void
    onCopyLink: (key: string) => void
    onRenameOpen: (key: string, isFolder: boolean, displayName: string) => void
    onMoveOpen: (items: { key: string; isFolder: boolean }[]) => void
    onShareLinkOpen: (key: string) => void
}

// ── List view ─────────────────────────────────────────────────────────────────

function ListView({
    filteredPrefixes, filteredObjects, currentPrefix, selectedKeys, hasSelection,
    allSelected, someSelected, onSelectAll, onToggleKey, onNavigateInto, onDownload, onOpenPreview, onDeleteSingle,
    onCopyS3Path, onCopyLink, onRenameOpen, onMoveOpen, onShareLinkOpen,
    sortCol, sortDir, onSort,
    focusedIndex, onFocusRow,
}: SharedProps & {
    allSelected: boolean; someSelected: boolean; onSelectAll: () => void
    sortCol: SortCol; sortDir: SortDir; onSort: (col: SortCol) => void
    focusedIndex: number | null; onFocusRow: (i: number) => void
}) {
    return (
        <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
                <tr className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
                    <th className="w-12 pl-4 pr-2 py-2.5 border-b text-left">
                        <Checkbox checked={allSelected} indeterminate={someSelected} onToggle={onSelectAll} />
                    </th>
                    <SortHeader col="name" label="Name" current={sortCol} dir={sortDir} onSort={onSort} />
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b w-24 hidden md:table-cell">Type</th>
                    <SortHeader col="size" label="Size" current={sortCol} dir={sortDir} onSort={onSort} className="w-24 hidden sm:table-cell" />
                    <SortHeader col="modified" label="Modified" current={sortCol} dir={sortDir} onSort={onSort} className="w-36 hidden lg:table-cell" />
                    <th className="w-12 border-b" />
                </tr>
            </thead>
            <tbody>
                {filteredPrefixes.map((prefix, rowIdx) => {
                    const name = prefix.replace(currentPrefix, "").replace(/\/$/, "")
                    const selected = selectedKeys.has(prefix)
                    const focused = focusedIndex === rowIdx
                    const actions: ItemActionProps = {
                        isFolder: true, isPreviewable: false,
                        onNavigate: () => onNavigateInto(prefix),
                        onDownload: () => {},
                        onDelete: () => onDeleteSingle(prefix),
                        onRename: () => onRenameOpen(prefix, true, name),
                        onMoveOpen: () => onMoveOpen([{ key: prefix, isFolder: true }]),
                        onCopyPath: () => onCopyS3Path(prefix),
                        onCopyLink: null,
                        onShareLink: null,
                    }
                    return (
                        <WithContextMenu key={prefix} {...actions}>
                            <tr
                                {...(focused ? { "data-focused-row": "" } : {})}
                                className={cn(
                                    "group cursor-pointer transition-colors duration-75",
                                    selected ? "bg-blue-50 dark:bg-blue-950/30" : "hover:bg-muted/40",
                                    focused && "outline outline-2 outline-blue-400/60 dark:outline-blue-600/60 outline-offset-[-2px]",
                                )}
                                onClick={(e) => { if (isCheckboxClick(e)) return; onFocusRow(rowIdx); onNavigateInto(prefix) }}
                            >
                                <td className="pl-4 pr-2 py-2.5 border-b border-border/40">
                                    <Checkbox checked={selected} onToggle={() => onToggleKey(prefix)} />
                                </td>
                                <td className="px-3 py-2.5 border-b border-border/40">
                                    <div className="flex items-center gap-3">
                                        <div className="size-8 rounded-lg bg-amber-400/15 flex items-center justify-center shrink-0">
                                            <IconFolder className="size-[18px] text-amber-500" />
                                        </div>
                                        <span className="font-medium truncate">{name}</span>
                                    </div>
                                </td>
                                <td className="px-3 py-2.5 border-b border-border/40 text-xs text-muted-foreground hidden md:table-cell">Folder</td>
                                <td className="px-3 py-2.5 border-b border-border/40 text-xs text-muted-foreground hidden sm:table-cell">—</td>
                                <td className="px-3 py-2.5 border-b border-border/40 text-xs text-muted-foreground hidden lg:table-cell">—</td>
                                <td className="px-3 py-2.5 border-b border-border/40">
                                    <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                        <RowActions {...actions} />
                                    </div>
                                </td>
                            </tr>
                        </WithContextMenu>
                    )
                })}
                {filteredObjects.map((obj, idx) => {
                    const name = obj.key.replace(currentPrefix, "")
                    if (!name) return null
                    const rowIdx = filteredPrefixes.length + idx
                    const selected = selectedKeys.has(obj.key)
                    const focused = focusedIndex === rowIdx
                    const type = getFileType(name)
                    const prevable = isPreviewable(type)
                    const actions: ItemActionProps = {
                        isFolder: false, isPreviewable: prevable,
                        onNavigate: null,
                        onPreview: prevable ? () => onOpenPreview(obj.key) : undefined,
                        onDownload: () => onDownload(obj.key),
                        onDelete: () => onDeleteSingle(obj.key),
                        onRename: () => onRenameOpen(obj.key, false, name),
                        onMoveOpen: () => onMoveOpen([{ key: obj.key, isFolder: false }]),
                        onCopyPath: () => onCopyS3Path(obj.key),
                        onCopyLink: () => onCopyLink(obj.key),
                        onShareLink: () => onShareLinkOpen(obj.key),
                    }
                    return (
                        <WithContextMenu key={obj.key} {...actions}>
                            <tr
                                {...(focused ? { "data-focused-row": "" } : {})}
                                className={cn(
                                    "group cursor-pointer transition-colors duration-75",
                                    selected ? "bg-blue-50 dark:bg-blue-950/30" : "hover:bg-muted/40",
                                    focused && "outline outline-2 outline-blue-400/60 dark:outline-blue-600/60 outline-offset-[-2px]",
                                )}
                                onClick={(e) => { if (!isCheckboxClick(e)) { onFocusRow(rowIdx); onToggleKey(obj.key) } }}
                                onDoubleClick={() => prevable ? onOpenPreview(obj.key) : onDownload(obj.key)}
                            >
                                <td className="pl-4 pr-2 py-2.5 border-b border-border/40">
                                    <div className={cn("transition-opacity duration-100", !hasSelection && !selected ? "opacity-0 group-hover:opacity-100" : "opacity-100")}>
                                        <Checkbox checked={selected} onToggle={() => onToggleKey(obj.key)} />
                                    </div>
                                </td>
                                <td className="px-3 py-2.5 border-b border-border/40">
                                    <div className="flex items-center gap-3">
                                        <div className={cn("size-8 rounded-lg flex items-center justify-center shrink-0", TYPE_BG_CLASS[type])}>
                                            <FileIconComp type={type} className="size-[18px]" />
                                        </div>
                                        <span className="font-medium truncate">{name}</span>
                                    </div>
                                </td>
                                <td className="px-3 py-2.5 border-b border-border/40 text-xs text-muted-foreground hidden md:table-cell">{TYPE_LABEL[type]}</td>
                                <td className="px-3 py-2.5 border-b border-border/40 text-xs text-muted-foreground hidden sm:table-cell">
                                    {obj.size != null ? formatBytes(obj.size) : "—"}
                                </td>
                                <td className="px-3 py-2.5 border-b border-border/40 text-xs text-muted-foreground hidden lg:table-cell">
                                    {obj.lastModified ? new Date(obj.lastModified).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—"}
                                </td>
                                <td className="px-3 py-2.5 border-b border-border/40">
                                    <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                        <RowActions {...actions} />
                                    </div>
                                </td>
                            </tr>
                        </WithContextMenu>
                    )
                })}
            </tbody>
        </table>
    )
}

// ── Grid view ─────────────────────────────────────────────────────────────────

function GridView({
    filteredPrefixes, filteredObjects, currentPrefix, selectedKeys, hasSelection,
    onToggleKey, onNavigateInto, onDownload, onOpenPreview, onDeleteSingle,
    onCopyS3Path, onCopyLink, onRenameOpen, onMoveOpen, onShareLinkOpen,
}: SharedProps) {
    return (
        <div className="p-5 grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {filteredPrefixes.map((prefix) => {
                const name = prefix.replace(currentPrefix, "").replace(/\/$/, "")
                const selected = selectedKeys.has(prefix)
                const actions: ItemActionProps = {
                    isFolder: true, isPreviewable: false,
                    onNavigate: () => onNavigateInto(prefix),
                    onDownload: () => {},
                    onDelete: () => onDeleteSingle(prefix),
                    onRename: () => onRenameOpen(prefix, true, name),
                    onMoveOpen: () => onMoveOpen([{ key: prefix, isFolder: true }]),
                    onCopyPath: () => onCopyS3Path(prefix),
                    onCopyLink: null,
                    onShareLink: null,
                }
                return (
                    <WithContextMenu key={prefix} {...actions}>
                        <div
                            className={cn(
                                "group relative flex flex-col rounded-xl border overflow-hidden cursor-pointer select-none transition-all duration-200",
                                selected
                                    ? "border-blue-400 dark:border-blue-600 ring-2 ring-blue-200 dark:ring-blue-900 shadow-sm"
                                    : "border-border/60 hover:border-border hover:shadow-lg hover:-translate-y-0.5",
                            )}
                            onClick={(e) => { if (!isCheckboxClick(e)) onNavigateInto(prefix) }}
                        >
                            <div className={cn(
                                "relative flex items-center justify-center h-28",
                                selected ? "bg-blue-50 dark:bg-blue-950/30" : "bg-amber-400/10 group-hover:bg-amber-400/15 transition-colors",
                            )}>
                                <IconFolder className="size-14 text-amber-500 drop-shadow-sm" />
                                <div className={cn("absolute top-2 left-2 transition-opacity duration-100", hasSelection || selected ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                                    <Checkbox checked={selected} onToggle={() => onToggleKey(prefix)} />
                                </div>
                                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button className="p-1 rounded-md bg-white/70 dark:bg-black/50 backdrop-blur-sm hover:bg-white dark:hover:bg-black/70" onClick={(e) => { e.stopPropagation(); onRenameOpen(prefix, true, name) }}>
                                        <IconPencil className="size-3.5 text-muted-foreground" />
                                    </button>
                                    <button className="p-1 rounded-md bg-white/70 dark:bg-black/50 backdrop-blur-sm hover:bg-white dark:hover:bg-black/70" onClick={(e) => { e.stopPropagation(); onNavigateInto(prefix) }}>
                                        <IconChevronRight className="size-3.5 text-muted-foreground" />
                                    </button>
                                </div>
                            </div>
                            <div className={cn("px-3 py-2.5 border-t", selected ? "bg-blue-50/70 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800" : "bg-background border-border/40")}>
                                <p className="text-xs font-semibold truncate leading-snug" title={name}>{name}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">Folder</p>
                            </div>
                        </div>
                    </WithContextMenu>
                )
            })}

            {filteredObjects.map((obj) => {
                const name = obj.key.replace(currentPrefix, "")
                if (!name) return null
                const selected = selectedKeys.has(obj.key)
                const type = getFileType(name)
                const prevable = isPreviewable(type)
                const actions: ItemActionProps = {
                    isFolder: false, isPreviewable: prevable,
                    onNavigate: null,
                    onPreview: prevable ? () => onOpenPreview(obj.key) : undefined,
                    onDownload: () => onDownload(obj.key),
                    onDelete: () => onDeleteSingle(obj.key),
                    onRename: () => onRenameOpen(obj.key, false, name),
                    onMoveOpen: () => onMoveOpen([{ key: obj.key, isFolder: false }]),
                    onCopyPath: () => onCopyS3Path(obj.key),
                    onCopyLink: () => onCopyLink(obj.key),
                    onShareLink: () => onShareLinkOpen(obj.key),
                }
                return (
                    <WithContextMenu key={obj.key} {...actions}>
                        <div
                            className={cn(
                                "group relative flex flex-col rounded-xl border overflow-hidden cursor-pointer select-none transition-all duration-200",
                                selected
                                    ? "border-blue-400 dark:border-blue-600 ring-2 ring-blue-200 dark:ring-blue-900 shadow-sm"
                                    : "border-border/60 hover:border-border hover:shadow-lg hover:-translate-y-0.5",
                            )}
                            onClick={(e) => { if (!isCheckboxClick(e)) onToggleKey(obj.key) }}
                            onDoubleClick={() => prevable ? onOpenPreview(obj.key) : onDownload(obj.key)}
                        >
                            <div className={cn(
                                "relative flex items-center justify-center h-28",
                                selected ? "bg-blue-50 dark:bg-blue-950/30" : TYPE_BG_CLASS[type],
                            )}>
                                <FileIconComp type={type} className="size-14 drop-shadow-sm" />
                                <div className={cn("absolute top-2 left-2 transition-opacity duration-100", hasSelection || selected ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                                    <Checkbox checked={selected} onToggle={() => onToggleKey(obj.key)} />
                                </div>
                                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button className="p-1 rounded-md bg-white/70 dark:bg-black/50 backdrop-blur-sm hover:bg-white dark:hover:bg-black/70" onClick={(e) => { e.stopPropagation(); onRenameOpen(obj.key, false, name) }}>
                                        <IconPencil className="size-3.5 text-muted-foreground" />
                                    </button>
                                    {prevable && (
                                        <button className="p-1 rounded-md bg-white/70 dark:bg-black/50 backdrop-blur-sm hover:bg-white dark:hover:bg-black/70" onClick={(e) => { e.stopPropagation(); onOpenPreview(obj.key) }}>
                                            <IconEye className="size-3.5 text-muted-foreground" />
                                        </button>
                                    )}
                                    <button className="p-1 rounded-md bg-white/70 dark:bg-black/50 backdrop-blur-sm hover:bg-white dark:hover:bg-black/70" onClick={(e) => { e.stopPropagation(); onDownload(obj.key) }}>
                                        <IconDownload className="size-3.5 text-muted-foreground" />
                                    </button>
                                    <button className="p-1 rounded-md bg-white/70 dark:bg-black/50 backdrop-blur-sm hover:bg-white dark:hover:bg-black/70" onClick={(e) => { e.stopPropagation(); onDeleteSingle(obj.key) }}>
                                        <IconTrash className="size-3.5 text-destructive/80" />
                                    </button>
                                </div>
                            </div>
                            <div className={cn("px-3 py-2.5 border-t", selected ? "bg-blue-50/70 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800" : "bg-background border-border/40")}>
                                <p className="text-xs font-semibold truncate leading-snug" title={name}>{name}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                    {obj.size != null ? formatBytes(obj.size) : TYPE_LABEL[type]}
                                </p>
                            </div>
                        </div>
                    </WithContextMenu>
                )
            })}
        </div>
    )
}

// ── Row actions (dropdown) ────────────────────────────────────────────────────

function RowActions({
    isFolder, isPreviewable: prevable, onNavigate, onPreview, onDownload, onDelete, onRename, onMoveOpen, onCopyPath, onCopyLink, onShareLink,
}: ItemActionProps) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="size-7" onClick={(e) => e.stopPropagation()}>
                    <IconDots className="size-4 text-muted-foreground" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
                {isFolder && onNavigate && (
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onNavigate() }}>
                        <IconChevronRight className="size-4 mr-2" /> Open
                    </DropdownMenuItem>
                )}
                {prevable && onPreview && (
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onPreview() }}>
                        <IconEye className="size-4 mr-2" /> Preview
                    </DropdownMenuItem>
                )}
                {!isFolder && (
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDownload() }}>
                        <IconDownload className="size-4 mr-2" /> Download
                    </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRename() }}>
                    <IconPencil className="size-4 mr-2" /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onMoveOpen() }}>
                    <IconArrowsMove className="size-4 mr-2" /> Move to…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onCopyPath() }}>
                    <IconCopy className="size-4 mr-2" /> Copy S3 path
                </DropdownMenuItem>
                {onCopyLink && (
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onCopyLink() }}>
                        <IconLink className="size-4 mr-2" /> Copy link
                    </DropdownMenuItem>
                )}
                {onShareLink && (
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onShareLink() }}>
                        <IconShare className="size-4 mr-2" /> Share link…
                    </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={(e) => { e.stopPropagation(); onDelete() }}>
                    <IconTrash className="size-4 mr-2" /> Delete
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
