"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { FolderLock } from "lucide-react"
import {
  IconAlertTriangle,
  IconChevronRight,
  IconDots,
  IconDownload,
  IconEye,
  IconFolder,
  IconFolderPlus,
  IconFolderSymlink,
  IconLock,
  IconPencil,
  IconPlus,
  IconChartPie,
  IconLayoutGrid,
  IconList,
  IconReplace,
  IconSettings,
  IconTrash,
  IconX,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToolSidebarLayout } from "@/components/tools/tool-sidebar"
import { useConfirm } from "@/components/confirm-dialog"
import { FilePreviewDialog, type PreviewState } from "@/components/s3-drive/file-preview-dialog"
import { FileIconComp } from "@/components/s3-drive/file-icon"
import { getFileType, isPreviewable } from "@/components/s3-drive/file-types"
import { useMasterKeyStore } from "@/store/master-key-store"
import {
  baseName,
  blobMime,
  NO_FOLDER,
  buildFolderTree,
  joinDir,
  looksLikeText,
  parentDir,
  visibleRange,
  type FolderNode,
  type SecureFileEntry,
} from "@/lib/secure-files"
import type { SecureFilesOperation, StorageTotals } from "@/lib/secure-files-api"
import {
  cancelSecureFilesOp,
  deleteSecureFile,
  deleteSecureFolder,
  exportSecureFile,
  getSecureFilesProgress,
  getSecureFilesSettings,
  importSecureFiles,
  listSecureFiles,
  patchSecureFile,
  pickFiles,
  pickFolder,
  pickSavePath,
  readSecureFile,
  renameSecureFolder,
  replaceSecureFile,
  setSecureFilesDir,
  type SecureFilesSettings,
} from "@/lib/secure-files-api"
import { FolderTree } from "./folder-tree"
import { Overview } from "./overview"
import { isThumbnailable, useThumbnails } from "./use-thumbnails"
import { cn } from "@/lib/utils"
import { safeGetItem, safeGetJSON, safeSetItem, safeSetJSON } from "@/lib/safe-storage"

const DISMISSED_ERRORS_KEY = "secureFilesDismissedErrors"
const VIEW_KEY = "secureFilesView"
/** Empty (not yet populated) logical folders — they only exist in metadata
 *  once a file lands in them, so keep the empty ones across lock/reload. */
const EXTRA_DIRS_KEY = "secureFilesEmptyDirs"

/** Stable fingerprint of an unreadable-files set: same set stays dismissed,
 *  a new/different set brings the banner back. */
function errorsKey(errors: { id: string }[]): string {
  return errors
    .map((e) => e.id)
    .sort()
    .join(",")
}

/** Largest plaintext handed to the webview for a preview (see `openPreview`). */
const MAX_PREVIEW_BYTES = 64 * 1024 * 1024

// ponytail: 5th formatBytes copy in the repo; promote to lib/utils when touching the others.
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function findNode(root: FolderNode, path: string): FolderNode | null {
  if (path === "") return root
  for (const c of root.children) {
    if (c.path === path) return c
    if (path.startsWith(`${c.path}/`)) return findNode(c, path)
  }
  return null
}

type PathDialogState = {
  title: string
  label: string
  hint?: string
  initial: string
  /** Empty input is valid (move to root). */
  allowEmpty?: boolean
  onSubmit: (value: string) => Promise<void>
}

export function SecureFilesTool() {
  const t = useTranslations("SecureFiles")
  const { confirm, dialog: confirmDialog } = useConfirm()
  const lockVault = useMasterKeyStore((s) => s.lock)

  const [settings, setSettings] = useState<SecureFilesSettings | null>(null)
  const [files, setFiles] = useState<SecureFileEntry[]>([])
  const [errors, setErrors] = useState<{ id: string; error: string }[]>([])
  const [totals, setTotals] = useState<StorageTotals | null>(null)
  const [showOverview, setShowOverview] = useState(false)
  const [extraDirs, setExtraDirs] = useState<string[]>(() => safeGetJSON<string[]>(EXTRA_DIRS_KEY) ?? [])
  const [currentDir, setCurrentDir] = useState("")
  const [view, setView] = useState<"list" | "grid">(() => (safeGetItem(VIEW_KEY) === "grid" ? "grid" : "list"))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<SecureFilesOperation | null>(null)
  const cancelled = useRef(false)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [pathDialog, setPathDialog] = useState<PathDialogState | null>(null)
  const [dismissedErrors, setDismissedErrors] = useState(() => safeGetItem(DISMISSED_ERRORS_KEY) ?? "")

  // Virtual scrolling: rows have fixed heights, only the visible window is
  // mounted — keeps 100k-file folders responsive.
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState({ w: 800, h: 600 })
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setViewport({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const previewUrl = useRef<string | null>(null)

  const revokePreview = useCallback(() => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = null
  }, [])
  useEffect(() => revokePreview, [revokePreview])

  const reload = useCallback(async () => {
    try {
      const s = await getSecureFilesSettings()
      setSettings(s)
      if (s.dir && s.exists) {
        const r = await listSecureFiles()
        setFiles(r.files)
        setErrors(r.errors)
        setTotals(r.totals)
      }
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

  /** Run a mutation, toast the outcome, refresh the listing. */
  const run = useCallback(
    async (fn: () => Promise<string | void>) => {
      setBusy(true)
      cancelled.current = false
      try {
        const msg = await fn()
        if (msg) toast.success(msg)
        await reload()
      } catch (e) {
        // A cancel surfaces as a plain stream error; the user already knows why.
        if (cancelled.current) toast.info(t("cancelled"))
        else toast.error(errMsg(e))
      } finally {
        setBusy(false)
        setProgress(null)
      }
    },
    [reload, t],
  )

  // Multi-GB files take long enough that a disabled toolbar is not an answer.
  // The backend counts plaintext bytes; polling beats plumbing an event channel
  // through the local API, which is request/response only.
  useEffect(() => {
    if (!busy) return
    let live = true
    const tick = async () => {
      try {
        const p = await getSecureFilesProgress()
        if (live) setProgress(p.status === "running" ? p : null)
      } catch {
        // The listing refresh at the end reports anything that actually broke.
      }
    }
    void tick()
    const timer = setInterval(tick, 400)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [busy])

  const cancelTransfer = async () => {
    cancelled.current = true
    setProgress(null)
    try {
      await cancelSecureFilesOp(progress?.id)
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  useEffect(() => {
    safeSetJSON(EXTRA_DIRS_KEY, extraDirs)
  }, [extraDirs])

  const tree = useMemo(() => buildFolderTree(files, extraDirs), [files, extraDirs])
  const node = findNode(tree, currentDir) ?? tree
  useEffect(() => {
    if (!findNode(tree, currentDir)) setCurrentDir("")
  }, [tree, currentDir])
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    setScrollTop(0)
  }, [currentDir, view])

  type ViewItem = { kind: "folder"; folder: FolderNode } | { kind: "file"; file: SecureFileEntry }
  const items: ViewItem[] = useMemo(
    () => [
      ...node.children.map((folder) => ({ kind: "folder" as const, folder })),
      ...node.files.map((file) => ({ kind: "file" as const, file })),
    ],
    [node],
  )

  // ── Storage folder ─────────────────────────────────────────────────────

  const chooseFolder = async () => {
    if (settings?.dir) {
      const ok = await confirm({
        title: t("changeFolderTitle"),
        description: t("changeFolderBody"),
        confirmLabel: t("chooseFolder"),
      })
      if (!ok) return
    }
    const dir = await pickFolder()
    if (!dir) return
    await run(async () => {
      const r = await setSecureFilesDir(dir)
      return r.moved > 0 ? t("movedCount", { count: r.moved }) : t("folderSet")
    })
  }

  // ── Import ─────────────────────────────────────────────────────────────

  const importPaths = async (paths: string[]) => {
    if (paths.length === 0) return
    await run(async () => {
      const r = await importSecureFiles(paths, currentDir)
      // Empty folders produce no entries; keep them visible in the tree.
      if (r.dirs.length > 0) setExtraDirs((prev) => [...new Set([...prev, ...r.dirs])])
      // A cancelled import reports the files it did not take as errors; the
      // user asked for that, so it is one info toast, not a list of failures.
      if (cancelled.current) {
        toast.info(t("cancelled"))
        return undefined
      }
      for (const e of r.errors) toast.error(`${baseName(e.path)}: ${e.error}`)
      if (r.imported.length > 0) return t("importedCount", { count: r.imported.length })
      if (r.dirs.length > 0 && r.errors.length === 0) return t("emptyFolderAdded")
      return undefined
    })
  }
  const addFiles = async () => importPaths(await pickFiles())
  const addFolder = async () => {
    const dir = await pickFolder()
    if (dir) await importPaths([dir])
  }

  // "Add folder" — creates a logical folder inside the folder being viewed.
  const newFolder = () =>
    setPathDialog({
      title: t("addFolder"),
      label: t("folderName"),
      initial: "",
      onSubmit: async (name) => {
        const path = joinDir(currentDir, name)
        setExtraDirs((d) => (d.includes(path) ? d : [...d, path]))
        setCurrentDir(path)
      },
    })

  // ── File actions ───────────────────────────────────────────────────────

  const openPreview = async (f: SecureFileEntry) => {
    // Preview ships the whole plaintext over IPC into a webview Blob, so the
    // cap is far below the import cap. Bigger files are exported to open.
    // ponytail: lift once a chunked container allows streaming previews.
    if (f.size > MAX_PREVIEW_BYTES) {
      toast.info(t("previewTooLarge", { size: formatBytes(MAX_PREVIEW_BYTES) }))
      return
    }
    const type = getFileType(f.name)
    setPreview({ key: f.name, url: null, loading: true, fileType: type })
    try {
      const bytes = new Uint8Array(await readSecureFile(f.id))
      let fileType = type
      let textContent: string | undefined
      if (type === "code" || type === "doc" || type === "sheet" || (type === "file" && looksLikeText(bytes))) {
        fileType = "code"
        textContent = new TextDecoder().decode(bytes)
      }
      if (!isPreviewable(fileType)) {
        setPreview(null)
        toast.info(t("noPreview"))
        return
      }
      revokePreview()
      const url = URL.createObjectURL(new Blob([bytes], { type: blobMime(fileType, f.name) }))
      previewUrl.current = url
      setPreview({ key: f.name, url, loading: false, fileType, textContent })
    } catch (e) {
      setPreview(null)
      toast.error(errMsg(e))
    }
  }
  const closePreview = () => {
    revokePreview()
    setPreview(null)
  }

  const exportFile = async (f: SecureFileEntry) => {
    const ok = await confirm({
      title: t("exportWarningTitle"),
      description: t("exportWarningBody"),
      confirmLabel: t("export"),
    })
    if (!ok) return
    const path = await pickSavePath(f.name)
    if (!path) return
    await run(async () => {
      await exportSecureFile(f.id, path)
      return t("exported")
    })
  }

  const replaceFile = async (f: SecureFileEntry) => {
    const { open } = await import("@tauri-apps/plugin-dialog")
    const path = await open({ multiple: false })
    if (!path) return
    await run(async () => {
      await replaceSecureFile(f.id, path)
      return t("replaced")
    })
  }

  const renameFile = (f: SecureFileEntry) =>
    setPathDialog({
      title: t("rename"),
      label: t("fileName"),
      initial: f.name,
      onSubmit: (name) => run(() => patchSecureFile(f.id, { name }).then(() => undefined)),
    })

  const moveFile = (f: SecureFileEntry) =>
    setPathDialog({
      title: t("move"),
      label: t("targetFolder"),
      hint: t("targetFolderHint"),
      initial: f.dir,
      allowEmpty: true,
      onSubmit: (dir) => run(() => patchSecureFile(f.id, { dir: dir.replace(/^\/+|\/+$/g, "") }).then(() => undefined)),
    })

  const deleteFile = async (f: SecureFileEntry) => {
    const ok = await confirm({
      title: t("deleteFileTitle"),
      description: t("deleteFileBody", { name: f.name }),
      confirmLabel: t("delete"),
      destructive: true,
    })
    if (ok) await run(() => deleteSecureFile(f.id).then(() => t("deleted")))
  }

  // ── Folder actions ─────────────────────────────────────────────────────

  const renameFolder = (path: string) =>
    setPathDialog({
      title: t("rename"),
      label: t("folderName"),
      initial: baseName(path),
      onSubmit: async (name) => {
        const to = joinDir(parentDir(path), name)
        await run(async () => {
          await renameSecureFolder(path, to)
          setExtraDirs((d) => d.map((x) => (x === path || x.startsWith(`${path}/`) ? to + x.slice(path.length) : x)))
          if (currentDir === path || currentDir.startsWith(`${path}/`)) setCurrentDir(to + currentDir.slice(path.length))
        })
      },
    })

  const deleteFolder = async (path: string) => {
    const ok = await confirm({
      title: t("deleteFolderTitle"),
      description: t("deleteFolderBody", { dir: path }),
      confirmLabel: t("delete"),
      destructive: true,
    })
    if (!ok) return
    await run(async () => {
      const r = await deleteSecureFolder(path)
      setExtraDirs((d) => d.filter((x) => x !== path && !x.startsWith(`${path}/`)))
      if (currentDir === path || currentDir.startsWith(`${path}/`)) setCurrentDir(parentDir(path))
      return t("deletedCount", { count: r.deleted })
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const crumbs = currentDir ? currentDir.split("/") : []
  const hasDir = !!settings?.dir && settings.exists
  const dirMissing = !!settings?.dir && !settings.exists

  const folderMenu = (path: string) => (
    <>
      <DropdownMenuItem onClick={() => renameFolder(path)}><IconPencil className="size-4" /> {t("rename")}</DropdownMenuItem>
      <DropdownMenuItem onClick={() => deleteFolder(path)} className="text-destructive focus:text-destructive"><IconTrash className="size-4" /> {t("delete")}</DropdownMenuItem>
    </>
  )
  const fileMenu = (f: SecureFileEntry) => (
    <>
      <DropdownMenuItem onClick={() => openPreview(f)}><IconEye className="size-4" /> {t("preview")}</DropdownMenuItem>
      <DropdownMenuItem onClick={() => exportFile(f)}><IconDownload className="size-4" /> {t("export")}</DropdownMenuItem>
      <DropdownMenuItem onClick={() => replaceFile(f)}><IconReplace className="size-4" /> {t("replace")}</DropdownMenuItem>
      <DropdownMenuItem onClick={() => renameFile(f)}><IconPencil className="size-4" /> {t("rename")}</DropdownMenuItem>
      <DropdownMenuItem onClick={() => moveFile(f)}><IconFolderSymlink className="size-4" /> {t("move")}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => deleteFile(f)} className="text-destructive focus:text-destructive"><IconTrash className="size-4" /> {t("delete")}</DropdownMenuItem>
    </>
  )

  const LIST_ROW_H = 36
  const GRID_ROW_H = 152
  const listCols = "grid-cols-[minmax(0,1fr)_6rem_2.5rem] md:grid-cols-[minmax(0,1fr)_6rem_8rem_2.5rem]"
  const cols = view === "grid" ? Math.max(1, Math.floor((viewport.w - 24) / 124)) : 1
  const rowH = view === "grid" ? GRID_ROW_H : LIST_ROW_H
  const rowCount = Math.ceil(items.length / cols)
  const [startRow, endRow] = visibleRange(scrollTop, viewport.h, rowH, rowCount)

  // Thumbnails are decrypted for on-screen tiles only.
  const visibleFiles = useMemo(
    () =>
      view === "grid"
        ? items.slice(startRow * cols, endRow * cols).flatMap((it) => (it.kind === "file" ? [it.file] : []))
        : [],
    [items, startRow, endRow, cols, view],
  )
  const thumbs = useThumbnails(visibleFiles, view === "grid")

  const listRow = (it: ViewItem) => {
    const cell = "flex h-full min-w-0 items-center"
    if (it.kind === "folder") {
      return (
        <div key={it.folder.path} style={{ height: LIST_ROW_H }} className={cn("group grid items-center border-b border-border/50 hover:bg-muted/50", listCols)}>
          <button type="button" className={cn(cell, "gap-2 px-4 text-left")} onClick={() => setCurrentDir(it.folder.path)}>
            <IconFolder className="size-4 shrink-0 text-amber-500" />
            <span className="truncate">{it.folder.name}</span>
          </button>
          <span className="px-2 text-right text-muted-foreground">—</span>
          <span className="hidden md:block" />
          <span className="px-2 text-right"><RowMenu label={t("actions")}>{folderMenu(it.folder.path)}</RowMenu></span>
        </div>
      )
    }
    const f = it.file
    return (
      <div key={f.id} style={{ height: LIST_ROW_H }} className={cn("group grid items-center border-b border-border/50 hover:bg-muted/50", listCols)}>
        <button type="button" className={cn(cell, "gap-2 px-4 text-left")} onClick={() => openPreview(f)}>
          <FileIconComp type={getFileType(f.name)} className="size-4 shrink-0" />
          <span className="truncate">{f.name}</span>
        </button>
        <span className="px-2 text-right tabular-nums text-muted-foreground">{formatBytes(f.size)}</span>
        <span className="hidden px-2 text-right tabular-nums text-muted-foreground md:block">{new Date(f.mtime).toLocaleDateString()}</span>
        <span className="px-2 text-right"><RowMenu label={t("actions")}>{fileMenu(f)}</RowMenu></span>
      </div>
    )
  }

  const tile = (it: ViewItem) => {
    const isFolder = it.kind === "folder"
    const key = isFolder ? it.folder.path : it.file.id
    const name = isFolder ? it.folder.name : it.file.name
    const thumb = isFolder ? undefined : thumbs.get(it.file.id)
    return (
      <div key={key} className="group relative min-w-0">
        <button
          type="button"
          className="flex h-full w-full flex-col items-center gap-1.5 rounded-lg p-2 pt-3 transition-colors hover:bg-muted/60"
          onClick={() => (isFolder ? setCurrentDir(it.folder.path) : openPreview(it.file))}
        >
          <span className="flex h-[4.5rem] w-full items-center justify-center overflow-hidden rounded-md bg-muted/40">
            {isFolder ? (
              <IconFolder className="size-10 text-amber-500" strokeWidth={1.5} />
            ) : thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
            ) : (
              <FileIconComp
                type={getFileType(name)}
                className={cn("size-10", !isFolder && isThumbnailable(it.file) && "animate-pulse")}
              />
            )}
          </span>
          <span className="w-full truncate text-center text-xs" title={name}>{name}</span>
          {!isFolder && <span className="text-[10px] tabular-nums text-muted-foreground">{formatBytes(it.file.size)}</span>}
        </button>
        <div className="absolute right-1 top-1">
          <RowMenu label={t("actions")}>{isFolder ? folderMenu(it.folder.path) : fileMenu(it.file)}</RowMenu>
        </div>
      </div>
    )
  }

  const actions = (
    <>
      <Button size="icon" variant="ghost" className="size-7" aria-label={t("addFiles")} onClick={addFiles} disabled={!hasDir || busy}>
        <IconPlus className="size-4" />
      </Button>
      <Button size="icon" variant="ghost" className="size-7" aria-label={t("newFolder")} onClick={newFolder} disabled={!hasDir || busy}>
        <IconFolderPlus className="size-4" />
      </Button>
      <Button size="icon" variant="ghost" className="size-7" aria-label={t("lock")} onClick={lockVault}>
        <IconLock className="size-4" />
      </Button>
    </>
  )

  const openFolder = useCallback((path: string) => {
    setShowOverview(false)
    setCurrentDir(path)
  }, [])

  const sidebar = hasDir ? (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b p-2">
        <button
          type="button"
          onClick={() => setShowOverview(true)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted",
            showOverview && "bg-muted font-medium",
          )}
        >
          <IconChartPie className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{t("overview")}</span>
        </button>
      </div>
      <FolderTree root={tree} currentDir={showOverview ? NO_FOLDER : currentDir} onSelect={openFolder} onRename={renameFolder} onDelete={deleteFolder} />
    </div>
  ) : (
    <p className="p-4 text-xs text-muted-foreground">{t("chooseFolderBody")}</p>
  )

  return (
    <ToolSidebarLayout toolId="secure-files" icon={FolderLock} title={t("title")} actions={actions} sidebar={sidebar} className="bg-background mobile-nav-offset">
      <div className="flex h-full min-h-0 flex-col">
        {/* Toolbar */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
          <nav className="flex min-w-0 flex-1 items-center gap-1 text-sm" aria-label={t("breadcrumb")}>
            {showOverview ? (
              <span className="truncate font-medium">{t("overview")}</span>
            ) : (
              <>
                <button type="button" className="truncate hover:underline" onClick={() => openFolder("")}>{t("allFiles")}</button>
                {crumbs.map((c, i) => {
                  const path = crumbs.slice(0, i + 1).join("/")
                  return (
                    <React.Fragment key={path}>
                      <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                      <button type="button" className="truncate hover:underline" onClick={() => openFolder(path)}>{c}</button>
                    </React.Fragment>
                  )
                })}
              </>
            )}
          </nav>
          {hasDir && (
            <>
              <Button size="sm" variant="outline" onClick={addFiles} disabled={busy}>
                <IconPlus className="size-4" /> {t("addFiles")}
              </Button>
              <Button size="sm" variant="outline" onClick={newFolder} disabled={busy}>
                <IconFolderPlus className="size-4" /> {t("addFolder")}
              </Button>
              <Button size="sm" variant="outline" onClick={addFolder} disabled={busy}>
                <IconFolderSymlink className="size-4" /> {t("importFolder")}
              </Button>
            </>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label={view === "list" ? t("viewGrid") : t("viewList")}
            onClick={() => {
              const next = view === "list" ? "grid" : "list"
              setView(next)
              safeSetItem(VIEW_KEY, next)
            }}
          >
            {view === "list" ? <IconLayoutGrid className="size-4" /> : <IconList className="size-4" />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="size-8" aria-label={t("settings")}>
                <IconSettings className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-xs">
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                <div className="font-medium text-foreground">{t("storageFolder")}</div>
                <div className="truncate font-mono" title={settings?.dir ?? ""}>{settings?.dir ?? t("notSet")}</div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={chooseFolder}>
                <IconFolder className="size-4" /> {hasDir ? t("changeFolder") : t("chooseFolder")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {progress && (
          <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2 text-xs">
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {t("working", { done: formatBytes(progress.done), total: formatBytes(progress.total) })}
            </span>
            <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${Math.min(100, Math.round((progress.done / Math.max(1, progress.total)) * 100))}%` }}
              />
            </div>
            <Button size="sm" variant="ghost" className="h-6 shrink-0 px-2" onClick={cancelTransfer}>
              {t("cancel")}
            </Button>
          </div>
        )}

        {errors.length > 0 && errorsKey(errors) !== dismissedErrors && (
          <div className="mx-4 mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
            <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{t("unreadableCount", { count: errors.length })}</div>
              <div className="text-muted-foreground">{t("unreadableHint")}</div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("dismiss")}
              className="-mr-1 -mt-0.5 size-6 shrink-0"
              onClick={() => {
                const key = errorsKey(errors)
                setDismissedErrors(key)
                safeSetItem(DISMISSED_ERRORS_KEY, key)
              }}
            >
              <IconX className="size-3.5" />
            </Button>
          </div>
        )}

        <div ref={scrollRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} className="min-h-0 flex-1 overflow-y-auto">
          {loading ? null : hasDir && showOverview ? (
            <Overview
              files={files}
              tree={tree}
              totals={totals}
              errorCount={errors.length}
              dir={settings?.dir ?? null}
              onOpenFolder={openFolder}
            />
          ) : !hasDir ? (
            <EmptyState
              title={dirMissing ? t("folderMissingTitle") : t("chooseFolderTitle")}
              body={dirMissing ? t("folderMissingBody", { dir: settings?.dir ?? "" }) : t("chooseFolderBody")}
            >
              <Button onClick={chooseFolder} disabled={busy}>
                <IconFolder className="size-4" /> {t("chooseFolder")}
              </Button>
            </EmptyState>
          ) : node.children.length === 0 && node.files.length === 0 ? (
            <EmptyState title={t("emptyTitle")} body={t("emptyBody")}>
              <Button onClick={addFiles} disabled={busy}>
                <IconPlus className="size-4" /> {t("addFiles")}
              </Button>
              <Button variant="outline" onClick={addFolder} disabled={busy}>
                <IconFolderSymlink className="size-4" /> {t("importFolder")}
              </Button>
            </EmptyState>
          ) : (
            <>
              {view === "list" && (
                <div className={cn("sticky top-0 z-10 grid border-b bg-background py-2 text-xs font-medium text-muted-foreground", listCols)}>
                  <span className="px-4">{t("name")}</span>
                  <span className="px-2 text-right">{t("size")}</span>
                  <span className="hidden px-2 text-right md:block">{t("modified")}</span>
                  <span />
                </div>
              )}
              <div className="relative text-sm" style={{ height: rowCount * rowH }}>
                <div className="absolute inset-x-0" style={{ top: startRow * rowH }}>
                  {view === "grid"
                    ? Array.from({ length: endRow - startRow }, (_, i) => {
                        const r = startRow + i
                        return (
                          <div
                            key={r}
                            style={{ height: rowH, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                            className="grid gap-1 px-3"
                          >
                            {items.slice(r * cols, (r + 1) * cols).map(tile)}
                          </div>
                        )
                      })
                    : items.slice(startRow, endRow).map(listRow)}
                </div>
              </div>
            </>
          )}
        </div>

        <p className="shrink-0 border-t px-4 py-1.5 text-[11px] text-muted-foreground">{t("footerNote")}</p>
      </div>

      <FilePreviewDialog preview={preview} onClose={closePreview} onDownload={() => { const f = files.find((x) => x.name === preview?.key); if (f) void exportFile(f) }} />
      <PathDialog state={pathDialog} onClose={() => setPathDialog(null)} />
      {confirmDialog}
    </ToolSidebarLayout>
  )
}

function EmptyState({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="flex size-14 items-center justify-center rounded-full border bg-muted/60">
          <FolderLock className="size-6 text-muted-foreground/70" />
        </div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{body}</p>
        <div className="mt-1 flex flex-wrap justify-center gap-2">{children}</div>
      </div>
    </div>
  )
}

function RowMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={label} className={cn("size-7 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100")}>
          <IconDots className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}

/** One text-input dialog for rename / move / new folder. */
function PathDialog({ state, onClose }: { state: PathDialogState | null; onClose: () => void }) {
  const t = useTranslations("SecureFiles")
  const [value, setValue] = useState("")
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (state) setValue(state.initial)
  }, [state])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!state) return
    const v = value.trim()
    if (!v && !state.allowEmpty) return
    setSaving(true)
    try {
      await state.onSubmit(v)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={state !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{state?.title}</DialogTitle>
          {state?.hint && <DialogDescription>{state.hint}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="sf-path">{state?.label}</Label>
            <Input id="sf-path" value={value} onChange={(e) => setValue(e.target.value)} autoFocus onFocus={(e) => e.target.select()} disabled={saving} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>{t("cancel")}</Button>
            <Button type="submit" disabled={saving}>{t("save")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
