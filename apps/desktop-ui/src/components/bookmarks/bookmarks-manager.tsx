"use client"

import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"
import {
    IconSearch,
    IconPlus,
    IconLayoutGrid,
    IconList,
    IconUpload,
    IconDownload,
    IconFolderPlus,
    IconX,
    IconDotsVertical,
    IconCheck,
    IconTrash,
    IconLoader2,
    IconBookmark
} from "@tabler/icons-react"
import { useBookmarkStore, useFilteredBookmarks, useAllTags } from "@/store/bookmark-store"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll"
import FolderTree from "./folder-tree"
import BookmarkGrid from "./bookmark-grid"
import { ToolSidebarLayout, useToolSidebarPanel } from "@/components/tools/tool-sidebar"
// ponytail: dialogs lazy-loaded; only fetched when user opens them
const AddBookmarkDialog = dynamic(() => import("./add-bookmark-dialog"))
const ImportDialog = dynamic(() => import("./import-dialog"))
const AddFolderDialog = dynamic(() => import("./add-folder-dialog"))
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { exportBookmarksToHTML, exportBookmarksToJSON } from "@/lib/bookmark-parser"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { downloadFile } from "@/lib/desktop/save-file"

/** Lives inside ToolSidebarLayout so it can dismiss the mobile sheet on pick. */
function FolderPanel({ onSelectFolder }: { onSelectFolder: (id: string | null) => void }) {
    const panel = useToolSidebarPanel()
    return (
        <FolderTree
            onSelectFolder={(id: string | null) => {
                onSelectFolder(id)
                if (panel?.isOverlay) panel.close()
            }}
        />
    )
}

export default function BookmarksManager() {
    const t = useTranslations("Bookmarks.manager")
    const [isAddBookmarkOpen, setIsAddBookmarkOpen] = useState(false)
    const [isImportOpen, setIsImportOpen] = useState(false)
    const [isAddFolderOpen, setIsAddFolderOpen] = useState(false)
    const [editingBookmark, setEditingBookmark] = useState<string | null>(null)
    const [selectionMode, setSelectionMode] = useState(false)
    const [selectedBookmarkIds, setSelectedBookmarkIds] = useState<Set<string>>(new Set())
    const [sortBy, setSortBy] = useState<"recent" | "alphabetical">("recent")
    const [showAllTags, setShowAllTags] = useState(false)
    const searchInputRef = useRef<HTMLInputElement>(null)
    const bookmarkScrollRef = useRef<HTMLDivElement>(null)

    const {
        searchQuery,
        setSearchQuery,
        viewMode,
        setViewMode,
        bookmarks,
        folders,
        selectedFolderId,
        setSelectedFolder,
        deleteBookmark
    } = useBookmarkStore()

    const filteredBookmarks = useFilteredBookmarks()
    const allTags = useAllTags()

    const handleExportHTML = useCallback(() => {
        const html = exportBookmarksToHTML(bookmarks, folders)
        const blob = new Blob([html], { type: 'text/html' })
        downloadFile(blob, 'bookmarks.html')
    }, [bookmarks, folders])

    const handleExportJSON = useCallback(() => {
        const json = exportBookmarksToJSON(bookmarks, folders)
        const blob = new Blob([json], { type: 'application/json' })
        downloadFile(blob, 'bookmarks.json')
    }, [bookmarks, folders])

    const handleEditBookmark = useCallback((id: string) => {
        setEditingBookmark(id)
        setIsAddBookmarkOpen(true)
    }, [])

    const handleCloseAddBookmark = useCallback(() => {
        setIsAddBookmarkOpen(false)
        setEditingBookmark(null)
    }, [])

    const selectedFolderName = selectedFolderId === null
        ? t("allBookmarks")
        : selectedFolderId === 'uncategorized'
            ? t("uncategorized")
            : folders.find(f => f.id === selectedFolderId)?.name || t("unknownFolder")

    const displayedBookmarks = useMemo(() => {
        const list = [...filteredBookmarks]
        if (sortBy === "alphabetical") {
            list.sort((a, b) => a.title.localeCompare(b.title))
        } else {
            list.sort((a, b) => b.updatedAt - a.updatedAt)
        }
        return list
    }, [filteredBookmarks, sortBy])

    const bookmarkScrollResetKey = `${selectedFolderId ?? 'all'}-${searchQuery}-${sortBy}`
    const { displayCount: bmDisplayCount, sentinelRef: bmSentinelRef, hasMore: bmHasMore } = useInfiniteScroll({
        totalCount: displayedBookmarks.length,
        resetKey: bookmarkScrollResetKey,
        pageSize: 24,
        scrollContainerRef: bookmarkScrollRef,
    })
    const visibleBookmarks = displayedBookmarks.slice(0, bmDisplayCount)

    const clearSelection = useCallback(() => {
        setSelectedBookmarkIds(new Set())
    }, [])

    const toggleBookmarkSelected = useCallback((id: string) => {
        setSelectedBookmarkIds((prev) => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }, [])

    const selectAllVisible = useCallback(() => {
        setSelectedBookmarkIds(new Set(displayedBookmarks.map((bookmark) => bookmark.id)))
    }, [displayedBookmarks])

    const deleteSelected = useCallback(() => {
        selectedBookmarkIds.forEach((id) => deleteBookmark(id))
        setSelectedBookmarkIds(new Set())
        setSelectionMode(false)
    }, [deleteBookmark, selectedBookmarkIds])

    useEffect(() => {
        if (!selectionMode) {
            setSelectedBookmarkIds(new Set())
        }
    }, [selectionMode])

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            // Inactive tool tabs stay mounted under display:none — ignore global shortcuts there.
            if (!searchInputRef.current || searchInputRef.current.offsetParent === null) return
            const target = event.target as HTMLElement | null
            const isTyping =
                target?.tagName === "INPUT" ||
                target?.tagName === "TEXTAREA" ||
                target?.isContentEditable

            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault()
                searchInputRef.current?.focus()
            }

            if (event.key === "Escape" && selectionMode) {
                setSelectionMode(false)
            }

            if (event.key === "/" && !isTyping) {
                event.preventDefault()
                searchInputRef.current?.focus()
            }
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [selectionMode])

    const sidebar = (
        <>
            {/* Folder Tree */}
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
                <FolderPanel onSelectFolder={setSelectedFolder} />
            </div>

            {/* Tags Section */}
            {allTags.length > 0 && (
                <div className="shrink-0 border-t border-border/40 p-4">
                    <h3 className="text-sm font-medium text-muted-foreground mb-2">{t("tagsHeading")}</h3>
                    <div className="flex flex-wrap gap-1">
                        {(showAllTags ? allTags : allTags.slice(0, 10)).map(tag => (
                            <button
                                key={tag}
                                onClick={() => setSearchQuery(`#${tag}`)}
                                className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                            >
                                #{tag}
                            </button>
                        ))}
                        {allTags.length > 10 && (
                            <button
                                onClick={() => setShowAllTags(prev => !prev)}
                                className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
                            >
                                {showAllTags ? t("tagsShowLess") : t("tagsMore", { count: allTags.length - 10 })}
                            </button>
                        )}
                    </div>
                </div>
            )}
        </>
    )

    return (
        <ToolSidebarLayout
            toolId="bookmarks"
            icon={IconBookmark}
            title={t("foldersHeading")}
            actions={
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    aria-label={t("foldersHeading")}
                    onClick={() => setIsAddFolderOpen(true)}
                >
                    <IconFolderPlus className="h-4 w-4" />
                </Button>
            }
            sidebar={sidebar}
            className="bg-background mobile-nav-offset"
        >
            {/* Main Content */}
            <div className="flex-1 flex flex-col min-h-0 bg-background">
                {/* Toolbar - Fixed height, not scrollable */}
                <div className="shrink-0 h-12 px-3 border-b border-border/60 flex items-center gap-3 bg-background/70 backdrop-blur-md z-10">

                    {/* Search */}
                    <div className="relative flex-1 max-w-xl">
                        <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            ref={searchInputRef}
                            placeholder={t("searchPlaceholder")}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 pr-9 bg-muted/40 border-transparent focus:bg-background focus:border-input transition-all"
                        />
                        {searchQuery && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 hover:bg-transparent"
                                onClick={() => setSearchQuery('')}
                            >
                                <IconX className="h-3 w-3 text-muted-foreground hover:text-foreground transition-colors" />
                            </Button>
                        )}
                    </div>

                    {/* Desktop Actions - Visible on larger screens */}
                    <div className="hidden md:flex items-center gap-2 ml-auto">
                        <Select value={sortBy} onValueChange={(value: "recent" | "alphabetical") => setSortBy(value)}>
                            <SelectTrigger className="h-9 w-[150px] text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="recent">Recently updated</SelectItem>
                                <SelectItem value="alphabetical">A-Z title</SelectItem>
                            </SelectContent>
                        </Select>

                        {/* View Toggle */}
                        <div className="flex items-center p-1 bg-muted/40 rounded-lg border border-border/20">
                            <Button
                                variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                                size="icon"
                                className="h-7 w-7 rounded-sm"
                                onClick={() => setViewMode('grid')}
                            >
                                <IconLayoutGrid className="h-4 w-4" />
                            </Button>
                            <Button
                                variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                                size="icon"
                                className="h-7 w-7 rounded-sm"
                                onClick={() => setViewMode('list')}
                            >
                                <IconList className="h-4 w-4" />
                            </Button>
                        </div>

                        <Separator orientation="vertical" className="h-6 mx-1" />

                        {selectionMode ? (
                            <>
                                <Button variant="ghost" size="sm" className="h-9" onClick={selectAllVisible}>
                                    Select all
                                </Button>
                                <Button variant="ghost" size="sm" className="h-9" onClick={clearSelection}>
                                    Clear
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-9 text-destructive hover:text-destructive"
                                    onClick={deleteSelected}
                                    disabled={selectedBookmarkIds.size === 0}
                                >
                                    <IconTrash className="h-4 w-4 mr-2" />
                                    Delete ({selectedBookmarkIds.size})
                                </Button>
                                <Button variant="secondary" size="sm" className="h-9" onClick={() => setSelectionMode(false)}>
                                    <IconCheck className="h-4 w-4 mr-2" />
                                    Done
                                </Button>
                            </>
                        ) : (
                            /* Select / Import / Export live in one overflow menu to keep the toolbar quiet */
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-9 w-9">
                                        <IconDotsVertical className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                    <DropdownMenuItem onClick={() => setSelectionMode(true)}>
                                        <IconCheck className="h-4 w-4 mr-2" />
                                        Select bookmarks
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setIsImportOpen(true)}>
                                        <IconUpload className="h-4 w-4 mr-2" />
                                        {t("import")}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={handleExportHTML}>
                                        <IconDownload className="h-4 w-4 mr-2" />
                                        {t("exportAsHtml")}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={handleExportJSON}>
                                        <IconDownload className="h-4 w-4 mr-2" />
                                        {t("exportAsJson")}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}

                        {/* Add Bookmark */}
                        <Button onClick={() => setIsAddBookmarkOpen(true)} className="ml-2 shadow-sm">
                            <IconPlus className="h-4 w-4 mr-2" />
                            {t("addBookmark")}
                        </Button>
                    </div>

                    {/* Mobile/Tablet Actions Menu */}
                    <div className="md:hidden flex items-center gap-1 ml-auto">
                        {/* View Toggle - Icon Only */}
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                            className="shrink-0"
                        >
                            {viewMode === 'grid' ? (
                                <IconLayoutGrid className="h-5 w-5" />
                            ) : (
                                <IconList className="h-5 w-5" />
                            )}
                        </Button>

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="shrink-0">
                                    <IconDotsVertical className="h-5 w-5" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem onClick={() => setSelectionMode((prev) => !prev)}>
                                    <IconCheck className="h-4 w-4 mr-2" />
                                    {selectionMode ? "Done selecting" : "Select bookmarks"}
                                </DropdownMenuItem>
                                {selectionMode && (
                                    <>
                                        <DropdownMenuItem onClick={selectAllVisible}>
                                            Select all visible
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={clearSelection}>
                                            Clear selection
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            className="text-destructive focus:text-destructive"
                                            onClick={deleteSelected}
                                            disabled={selectedBookmarkIds.size === 0}
                                        >
                                            <IconTrash className="h-4 w-4 mr-2" />
                                            Delete selected ({selectedBookmarkIds.size})
                                        </DropdownMenuItem>
                                    </>
                                )}
                                <DropdownMenuItem onClick={() => setIsImportOpen(true)}>
                                    <IconUpload className="h-4 w-4 mr-2" />
                                    {t("import")}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleExportHTML}>
                                    <IconDownload className="h-4 w-4 mr-2" />
                                    {t("exportAsHtml")}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleExportJSON}>
                                    <IconDownload className="h-4 w-4 mr-2" />
                                    {t("exportAsJson")}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>

                        {/* Add Bookmark - Prominent on mobile */}
                        <Button
                            onClick={() => setIsAddBookmarkOpen(true)}
                            size="icon"
                            className="shrink-0 ml-1 rounded-full h-9 w-9 shadow-sm"
                        >
                            <IconPlus className="h-5 w-5" />
                        </Button>
                    </div>
                </div>

                {/* Content Header - Fixed, not scrollable */}
                <div className="shrink-0 px-6 pt-6 pb-2">
                    <div className="flex items-end justify-between border-b border-border/40 pb-4">
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight text-foreground/90">{selectedFolderName}</h1>
                            <p className="text-sm text-muted-foreground mt-1 font-medium">
                                {t("bookmarkCount", { count: displayedBookmarks.length })}
                                {searchQuery && (
                                    <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-md bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 text-xs">
                                        {t("matchingQuery", { query: searchQuery })}
                                    </span>
                                )}
                                {selectionMode && (
                                    <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-md bg-primary/10 text-primary text-xs">
                                        {selectedBookmarkIds.size} selected
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Bookmarks Grid/List - Only this section scrolls */}
                <div ref={bookmarkScrollRef} className="flex-1 min-h-0 overflow-y-auto">
                    <div className="p-4">
                        <BookmarkGrid
                            bookmarks={visibleBookmarks}
                            viewMode={viewMode}
                            onEdit={handleEditBookmark}
                            selectionMode={selectionMode}
                            selectedBookmarkIds={selectedBookmarkIds}
                            onToggleSelect={toggleBookmarkSelected}
                            onTagClick={(tag) => setSearchQuery(`#${tag}`)}
                            onAdd={!searchQuery ? () => setIsAddBookmarkOpen(true) : undefined}
                            onImport={!searchQuery ? () => setIsImportOpen(true) : undefined}
                        />
                        {bmHasMore && (
                            <div className="space-y-4">
                                <div ref={bmSentinelRef} className="flex items-center justify-center py-6">
                                    <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
                                </div>
                                <div
                                    aria-hidden
                                    className={cn(
                                        viewMode === 'grid'
                                            ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4"
                                            : "flex flex-col gap-3"
                                    )}
                                >
                                    {Array.from({ length: viewMode === 'grid' ? 4 : 3 }).map((_, idx) => (
                                        <Skeleton
                                            key={idx}
                                            className={cn(
                                                viewMode === 'grid'
                                                    ? "h-32 rounded-xl border border-border/60"
                                                    : "h-20 rounded-lg border border-border/60"
                                            )}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                        {!bmHasMore && displayedBookmarks.length > 24 && (
                            <p className="py-6 text-center text-xs text-muted-foreground/40">
                                All {displayedBookmarks.length} bookmarks loaded
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Dialogs — mount only after first open so the chunks stay out of initial paint */}
            {isAddBookmarkOpen && (
                <AddBookmarkDialog
                    open={isAddBookmarkOpen}
                    onOpenChange={handleCloseAddBookmark}
                    editingId={editingBookmark}
                />
            )}
            {isImportOpen && (
                <ImportDialog
                    open={isImportOpen}
                    onOpenChange={setIsImportOpen}
                />
            )}
            {isAddFolderOpen && (
                <AddFolderDialog
                    open={isAddFolderOpen}
                    onOpenChange={setIsAddFolderOpen}
                />
            )}
        </ToolSidebarLayout>
    )
}
