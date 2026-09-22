"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import useAuth from "@/utils/useAuth";
import { useTranslations } from "next-intl";
import { useDebouncedCallback } from "use-debounce";
import {
  createCodeSnippetApi,
  deleteCodeSnippetApi,
  isSnippetDuplicateError,
  listCodeSnippetsApi,
  patchCodeSnippetApi,
} from "@/lib/code-snippets-api";
import { useCipherKey } from "@/lib/use-cipher-key";
import {
  IconPlus,
  IconTrash,
  IconCopy,
  IconCheck,
  IconEye,
  IconSparkles,
  IconSearch,
  IconMenu2,
  IconPencil,
  IconX,
  IconTag,
  IconFiles,
  IconCode,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useIsMobile } from "@/components/hooks/use-mobile";
import {
  useSnippetManagerStore,
  type CodeSnippet,
} from "@/store/snippet-manager-store";
import {
  resolveEditorLanguage,
  SNIPPET_LANGUAGE_AUTO,
  SNIPPET_MONACO_LANGUAGES,
} from "@/lib/snippet-language";
import { ToolPinButton } from "@/components/tools/tool-header";
import { ToolWrapper } from "@/components/tools/tool-wrapper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ToolSidebarActions, ToolSidebarLayout, useToolSidebarRail } from "@/components/tools/tool-sidebar";
import { cn } from "@/lib/utils";
import {
  SnippetMonaco,
  type SnippetMonacoHandle,
} from "./snippet-monaco";
import { LangDot } from "./snippet-list-item";
import { SnippetListContent } from "./snippet-list-content";
import { DeleteDialog } from "./delete-dialog";

type EditorMode = "view" | "edit";

// ── Languages that have a formatting provider ─────────────────────────────────

const FORMAT_SUPPORTED_LANGS = new Set([
  "json", "sql", "javascript", "typescript", "html", "css", "scss",
  "less", "xml", "yaml", "go", "rust", "java", "php", "csharp", "python",
]);


// ── Main component ────────────────────────────────────────────────────────────

export function SnippetManagerTool() {
  const t = useTranslations("SnippetManager");
  const { user, loading: authLoading } = useAuth();
  const userRef = useRef(user);
  userRef.current = user;

  // Zero-knowledge: snippet code is encrypted with the workspace cipher key
  // before it leaves the app. Ref so the stable async callbacks read the latest.
  const cipherKey = useCipherKey();
  const cipherKeyRef = useRef(cipherKey);
  cipherKeyRef.current = cipherKey;

  const snippets = useSnippetManagerStore((s) => s.snippets);
  const addSnippet = useSnippetManagerStore((s) => s.addSnippet);
  const updateSnippet = useSnippetManagerStore((s) => s.updateSnippet);
  const removeSnippet = useSnippetManagerStore((s) => s.removeSnippet);
  const importSnippets = useSnippetManagerStore((s) => s.importSnippets);
  const mergeSnippetFromRemote = useSnippetManagerStore((s) => s.mergeSnippetFromRemote);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftLanguage, setDraftLanguage] = useState(SNIPPET_LANGUAGE_AUTO);
  const [draftCode, setDraftCode] = useState("");
  const [debouncedCode, setDebouncedCode] = useState("");
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<EditorMode>("edit");
  const { isCopied: copied, copyToClipboard } = useCopyToClipboard();
  const [deleteTarget, setDeleteTarget] = useState<CodeSnippet | null>(null);
  const [listOpen, setListOpen] = useState(false);

  const monacoRef = useRef<SnippetMonacoHandle>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const debouncedSaveCode = useDebouncedCallback((code: string) => {
    const id = selectedIdRef.current;
    if (!id) return;
    useSnippetManagerStore.getState().updateSnippet(id, { code });
    const u = userRef.current;
    if (u) {
      void patchCodeSnippetApi(id, { code }, cipherKeyRef.current)
        .then((s) =>
          useSnippetManagerStore.getState().mergeSnippetFromRemote(s)
        )
        .catch(() => toast.error(t("toastSyncFailed")));
    }
  }, 450);

  const debouncedSetLangCode = useDebouncedCallback(
    (code: string) => setDebouncedCode(code),
    300
  );

  const debouncedPersistTitleLang = useDebouncedCallback(
    (title: string, language: string, id: string) => {
      useSnippetManagerStore.getState().updateSnippet(id, { title, language });
      const u = userRef.current;
      if (u) {
        void patchCodeSnippetApi(id, { title, language }, cipherKeyRef.current)
          .then((s) =>
            useSnippetManagerStore.getState().mergeSnippetFromRemote(s)
          )
          .catch(() => toast.error(t("toastSyncFailed")));
      }
    },
    400
  );

  const [storeHydrated, setStoreHydrated] = useState(() => {
    const p = useSnippetManagerStore.persist;
    return p?.hasHydrated?.() ?? true;
  });
  useEffect(() => {
    if (storeHydrated) return;
    const p = useSnippetManagerStore.persist;
    if (!p?.onFinishHydration) {
      setStoreHydrated(true);
      return;
    }
    return p.onFinishHydration(() => setStoreHydrated(true));
  }, [storeHydrated]);

  const guestBootstrapped = useRef(false);
  const serverBootstrappedUid = useRef<string | null>(null);
  const serverBootstrapInFlight = useRef(false);
  const [remoteListEpoch, setRemoteListEpoch] = useState(0);

  useEffect(() => {
    if (!storeHydrated || authLoading) return;
    // Server-backed snippets need the cipher key to en/decrypt code — wait for unlock.
    if (user && !cipherKey) return;

    if (!user) {
      if (guestBootstrapped.current) return;
      guestBootstrapped.current = true;
      serverBootstrappedUid.current = null;
      serverBootstrapInFlight.current = false;
      const { snippets: list, addSnippet: add } =
        useSnippetManagerStore.getState();
      if (list.length === 0) {
        const id = add({
          title: t("defaultSnippetTitle"),
          code: t("defaultSnippetCode"),
          language: SNIPPET_LANGUAGE_AUTO,
        });
        setSelectedId(id);
      } else {
        setSelectedId(list[0].id);
      }
      return;
    }

    guestBootstrapped.current = false;
    if (serverBootstrappedUid.current === user.uid) return;
    if (serverBootstrapInFlight.current) return;
    serverBootstrapInFlight.current = true;

    let cancelled = false;
    (async () => {
      try {
        const key = cipherKeyRef.current;
        const remote = await listCodeSnippetsApi(key);
        if (cancelled) return;
        if (remote.length > 0) {
          importSnippets(remote);
          setRemoteListEpoch((e) => e + 1);
        } else {
          const local = useSnippetManagerStore.getState().snippets;
          for (const sn of local) {
            try {
              await createCodeSnippetApi({
                id: sn.id,
                title: sn.title,
                language: sn.language,
                code: sn.code,
                createdAt: sn.createdAt,
                updatedAt: sn.updatedAt,
              }, key);
            } catch (e) {
              if (!isSnippetDuplicateError(e)) throw e;
            }
          }
          const again = await listCodeSnippetsApi(key);
          if (cancelled) return;
          importSnippets(again.length > 0 ? again : local);
          setRemoteListEpoch((e) => e + 1);
        }

        let list = useSnippetManagerStore.getState().snippets;
        if (list.length === 0) {
          const created = await createCodeSnippetApi({
            title: t("defaultSnippetTitle"),
            language: SNIPPET_LANGUAGE_AUTO,
            code: t("defaultSnippetCode"),
          }, key);
          if (cancelled) return;
          importSnippets([created]);
          setRemoteListEpoch((e) => e + 1);
          list = useSnippetManagerStore.getState().snippets;
        }

        serverBootstrappedUid.current = user.uid;

        setSelectedId((prev) => {
          const hit = list.find((s) => s.id === prev);
          return hit?.id ?? list[0]?.id ?? null;
        });
      } catch {
        if (!cancelled) toast.error(t("toastLoadFailed"));
      } finally {
        serverBootstrapInFlight.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [storeHydrated, authLoading, user, t, importSnippets, cipherKey]);

  useEffect(() => {
    debouncedSaveCode.cancel();
    if (!selectedId) {
      setDraftTitle("");
      setDraftLanguage(SNIPPET_LANGUAGE_AUTO);
      setDraftCode("");
      return;
    }
    const sn = useSnippetManagerStore
      .getState()
      .snippets.find((s) => s.id === selectedId);
    if (!sn) return;
    setDraftTitle(sn.title);
    setDraftLanguage(sn.language);
    setDraftCode(sn.code);
    setDebouncedCode(sn.code);
    setDraftTags(sn.tags ?? []);
    setTagInput("");
  }, [selectedId, debouncedSaveCode, remoteListEpoch]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = !q
      ? snippets
      : snippets.filter(
          (s) =>
            s.title.toLowerCase().includes(q) ||
            s.code.toLowerCase().includes(q) ||
            s.tags.some((tag) => tag.includes(q))
        );
    return [...list].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.updatedAt - a.updatedAt;
    });
  }, [snippets, search]);

  const snippetScrollRef = useRef<HTMLDivElement>(null);
  const { displayCount: snDisplayCount, sentinelRef: snSentinelRef, hasMore: snHasMore } = useInfiniteScroll({
    totalCount: filtered.length,
    resetKey: search,
    pageSize: 20,
    scrollContainerRef: snippetScrollRef,
  });
  const visibleSnippets = filtered.slice(0, snDisplayCount);
  const pinnedVisible = visibleSnippets.filter((s) => s.pinned);
  const unpinnedVisible = visibleSnippets.filter((s) => !s.pinned);

  // Pinned snippets are the sidebar's own shortlist, so they are what the
  // collapsed rail offers. Flushing the pending save mirrors the row click —
  // selecting from the rail must not drop an unsaved edit.
  useToolSidebarRail(
    "pinned",
    useMemo(
      () =>
        pinnedVisible.slice(0, 8).map((s) => ({
          id: s.id,
          label: s.title,
          icon: IconCode,
          active: s.id === selectedId,
          onSelect: () => {
            debouncedSaveCode.flush();
            setSelectedId(s.id);
          },
        })),
      [pinnedVisible, selectedId, debouncedSaveCode]
    )
  );

  const effectiveLanguage = useMemo(
    () => resolveEditorLanguage(draftLanguage, debouncedCode),
    [draftLanguage, debouncedCode]
  );

  const onCodeChange = useCallback(
    (code: string) => {
      setDraftCode(code);
      debouncedSaveCode(code);
      debouncedSetLangCode(code);
    },
    [debouncedSaveCode, debouncedSetLangCode]
  );

  const persistCode = useCallback(
    (id: string, code: string) => {
      updateSnippet(id, { code });
      const u = userRef.current;
      if (u) {
        void patchCodeSnippetApi(id, { code }, cipherKeyRef.current)
          .then((s) => useSnippetManagerStore.getState().mergeSnippetFromRemote(s))
          .catch(() => toast.error(t("toastSyncFailed")));
      }
    },
    [updateSnippet, t]
  );

  const handlePin = useCallback(
    (id: string) => {
      const sn = snippets.find((s) => s.id === id);
      if (!sn) return;
      const newPinned = !sn.pinned;
      updateSnippet(id, { pinned: newPinned });
      const u = userRef.current;
      if (u) {
        void patchCodeSnippetApi(id, { pinned: newPinned }, cipherKeyRef.current)
          .then((s) => mergeSnippetFromRemote(s))
          .catch(() => toast.error(t("toastSyncFailed")));
      }
    },
    [snippets, updateSnippet, mergeSnippetFromRemote, t]
  );

  const handleAddTag = useCallback(
    (tag: string) => {
      const trimmed = tag.trim().toLowerCase();
      if (!trimmed || draftTags.includes(trimmed) || !selectedId) return;
      const next = [...draftTags, trimmed];
      setDraftTags(next);
      updateSnippet(selectedId, { tags: next });
      const u = userRef.current;
      if (u) {
        void patchCodeSnippetApi(selectedId, { tags: next }, cipherKeyRef.current)
          .then((s) => mergeSnippetFromRemote(s))
          .catch(() => toast.error(t("toastSyncFailed")));
      }
    },
    [draftTags, selectedId, updateSnippet, mergeSnippetFromRemote, t]
  );

  const handleRemoveTag = useCallback(
    (tag: string) => {
      if (!selectedId) return;
      const next = draftTags.filter((tg) => tg !== tag);
      setDraftTags(next);
      updateSnippet(selectedId, { tags: next });
      const u = userRef.current;
      if (u) {
        void patchCodeSnippetApi(selectedId, { tags: next }, cipherKeyRef.current)
          .then((s) => mergeSnippetFromRemote(s))
          .catch(() => toast.error(t("toastSyncFailed")));
      }
    },
    [draftTags, selectedId, updateSnippet, mergeSnippetFromRemote, t]
  );

  const handleNewRef = useRef<() => void>(() => {});
  const handleFormatRef = useRef<() => void>(() => {});

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "n") { e.preventDefault(); handleNewRef.current(); }
      else if (e.key === "s") { e.preventDefault(); debouncedSaveCode.flush(); }
      else if (e.key === "/") { e.preventDefault(); handleFormatRef.current(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [debouncedSaveCode]);

  const handleNew = async () => {
    debouncedSaveCode.flush();
    const u = userRef.current;
    const payload = {
      title: t("newSnippetTitle"),
      code: "",
      language: SNIPPET_LANGUAGE_AUTO,
    };
    if (u) {
      try {
        const created = await createCodeSnippetApi(payload, cipherKeyRef.current);
        useSnippetManagerStore.getState().mergeSnippetFromRemote(created);
        setSelectedId(created.id);
      } catch {
        toast.error(t("toastSyncFailed"));
        return;
      }
    } else {
      const id = addSnippet(payload);
      setSelectedId(id);
    }
    setMode("edit");
    setListOpen(false);
  };

  const handleDuplicate = useCallback(async () => {
    if (!selectedId) return;
    const sn = snippets.find((s) => s.id === selectedId);
    if (!sn) return;
    debouncedSaveCode.flush();
    const payload = {
      title: `Copy of ${sn.title}`,
      code: sn.code,
      language: sn.language,
    };
    const u = userRef.current;
    if (u) {
      try {
        const created = await createCodeSnippetApi(payload, cipherKeyRef.current);
        useSnippetManagerStore.getState().mergeSnippetFromRemote(created);
        setSelectedId(created.id);
      } catch {
        toast.error(t("toastSyncFailed"));
        return;
      }
    } else {
      const id = addSnippet(payload);
      setSelectedId(id);
    }
    setMode("edit");
    setListOpen(false);
  }, [selectedId, snippets, debouncedSaveCode, addSnippet, t]);

  const handleCopy = () => {
    if (!draftCode) {
      toast.message(t("toastNothingToCopy"));
      return;
    }
    void copyToClipboard(draftCode, {
      successMessage: t("toastCopied"),
      errorMessage: t("toastCopyFailed"),
    });
  };

  const handleFormat = async () => {
    if (mode === "view") setMode("edit");
    const lang = effectiveLanguage;

    if (lang === "json") {
      try {
        const parsed = JSON.parse(draftCode);
        const next = JSON.stringify(parsed, null, 2);
        setDraftCode(next);
        if (selectedId) persistCode(selectedId, next);
        toast.success(t("toastFormatted"));
        return;
      } catch {
        toast.error(t("toastFormatJsonInvalid"));
        return;
      }
    }

    if (lang === "sql") {
      try {
        const { format } = await import("sql-formatter");
        const next = format(draftCode, { language: "sql" });
        setDraftCode(next);
        if (selectedId) persistCode(selectedId, next);
        toast.success(t("toastFormatted"));
        return;
      } catch {
        toast.error(t("toastFormatFailed"));
        return;
      }
    }

    try {
      await monacoRef.current?.formatDocument();
      toast.success(t("toastFormatted"));
    } catch {
      toast.message(t("toastFormatUnsupported"));
    }
  };

  handleNewRef.current = () => { void handleNew(); };
  handleFormatRef.current = () => { void handleFormat(); };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    const u = userRef.current;
    if (u) {
      try {
        await deleteCodeSnippetApi(id);
      } catch {
        toast.error(t("toastSyncFailed"));
        return;
      }
    }
    removeSnippet(id);
    setDeleteTarget(null);
    if (selectedId === id) {
      const next = useSnippetManagerStore.getState().snippets[0];
      setSelectedId(next?.id ?? null);
    }
    toast.success(t("toastDeleted"));
  };

  const isMobile = useIsMobile();

  // ── Snippet list panel ───────────────────────────────────────────────────────

  const snippetList = (
    <div className="flex h-full min-h-0 flex-col">
      {/* Search + new */}
      <div className="mb-3 flex gap-1.5">
        <div className="relative flex-1">
          <IconSearch className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-8 pl-8 text-xs"
            aria-label={t("searchAria")}
          />
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 cursor-pointer"
          onClick={handleNew}
          aria-label={t("newSnippet")}
        >
          <IconPlus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* List */}
      <SnippetListContent
        scrollRef={snippetScrollRef}
        pinnedVisible={pinnedVisible}
        unpinnedVisible={unpinnedVisible}
        filtered={filtered}
        selectedId={selectedId}
        snHasMore={snHasMore}
        snDisplayCount={snDisplayCount}
        sentinelRef={snSentinelRef}
        t={t}
        onPin={handlePin}
        onSelect={(id) => {
          debouncedSaveCode.flush();
          setSelectedId(id);
          setListOpen(false);
        }}
      />

      {/* Count footer */}
      {filtered.length > 0 && (
        <div className="border-t border-border/50 pt-2">
          <p className="text-center text-[11px] text-muted-foreground/60">
            {snHasMore ? `${snDisplayCount} / ${filtered.length}` : filtered.length}{" "}
            {filtered.length === 1 ? "snippet" : "snippets"}
          </p>
        </div>
      )}
    </div>
  );

  // ── Editor panel — shared across mobile + desktop ─────────────────────────

  const editorPanel = (
    <div className="flex h-full min-h-0 flex-col">
      {/* Compact single-row toolbar */}
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border/60 bg-background/70 px-3 backdrop-blur-md">
        {/* Inline title */}
        <Input
          id="snippet-title-d"
          value={draftTitle}
          onChange={(e) => {
            const v = e.target.value;
            setDraftTitle(v);
            if (selectedId) debouncedPersistTitleLang(v, draftLanguage, selectedId);
          }}
          placeholder={t("snippetTitlePlaceholder")}
          className="h-7 flex-1 border-0 bg-transparent px-1 text-sm font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          aria-label={t("snippetTitle")}
        />

        {/* Separator */}
        <div className="h-4 w-px shrink-0 bg-border/60" />

        {/* Language select */}
        <Select
          value={draftLanguage}
          onValueChange={(v) => {
            setDraftLanguage(v);
            if (selectedId) debouncedPersistTitleLang(draftTitle, v, selectedId);
          }}
        >
          <SelectTrigger
            aria-label={t("language")}
            className="h-7 w-auto cursor-pointer gap-1.5 border-0 bg-muted/50 px-2 text-xs shadow-none focus:ring-0 hover:bg-muted [&>span]:max-w-[80px]"
          >
            <LangDot lang={effectiveLanguage} />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SNIPPET_LANGUAGE_AUTO}>
              {t("languages.auto")}
            </SelectItem>
            {SNIPPET_MONACO_LANGUAGES.map((id) => (
              <SelectItem key={id} value={id}>
                {t(`languages.${id}` as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Auto-detect hint */}
        {draftLanguage === SNIPPET_LANGUAGE_AUTO && (
          <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
            <IconSparkles className="h-3 w-3 shrink-0" />
            {t(`languages.${effectiveLanguage}` as never)}
          </span>
        )}

        {/* Right-side actions */}
        <div className="ml-auto flex items-center gap-1">
          {/* View / Edit toggle */}
          <Tabs
            value={mode}
            onValueChange={(v) => setMode(v as EditorMode)}
          >
            <TabsList className="h-7">
              <TabsTrigger value="view" className="h-6 gap-1 px-2.5 text-xs">
                <IconEye className="h-3 w-3" />
                <span className="hidden sm:inline">{t("modeView")}</span>
              </TabsTrigger>
              <TabsTrigger value="edit" className="h-6 gap-1 px-2.5 text-xs">
                <IconPencil className="h-3 w-3" />
                <span className="hidden sm:inline">{t("modeEdit")}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="mx-1 h-4 w-px shrink-0 bg-border/60" />

          {/* Duplicate */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 cursor-pointer"
            onClick={() => { void handleDuplicate(); }}
            disabled={!selectedId}
            title="Duplicate snippet"
          >
            <IconFiles className="h-3.5 w-3.5" />
          </Button>

          {/* Format */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 cursor-pointer"
            onClick={handleFormat}
            disabled={!draftCode.trim() || !FORMAT_SUPPORTED_LANGS.has(effectiveLanguage)}
            title={t("format")}
          >
            <IconSparkles className="h-3.5 w-3.5" />
          </Button>

          {/* Copy */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 cursor-pointer"
            onClick={handleCopy}
            title={copied ? t("copied") : t("copy")}
          >
            {copied ? (
              <IconCheck className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <IconCopy className="h-3.5 w-3.5" />
            )}
          </Button>

          {/* Delete */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 cursor-pointer text-muted-foreground hover:text-destructive"
            onClick={() => {
              const sn = snippets.find((s) => s.id === selectedId);
              if (sn) setDeleteTarget(sn);
            }}
            title={t("deleteTitle")}
          >
            <IconTrash className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Tags row */}
      {selectedId && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/60 px-3 py-1.5 min-h-[32px]">
          <IconTag className="h-3 w-3 shrink-0 text-muted-foreground/50" />
          {draftTags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
            >
              {tag}
              <button
                type="button"
                onClick={() => handleRemoveTag(tag)}
                className="ml-0.5 cursor-pointer rounded hover:text-destructive"
              >
                <IconX className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
                e.preventDefault();
                handleAddTag(tagInput);
                setTagInput("");
              }
              if (e.key === "Backspace" && !tagInput && draftTags.length > 0) {
                handleRemoveTag(draftTags[draftTags.length - 1]);
              }
            }}
            onBlur={() => {
              if (tagInput.trim()) {
                handleAddTag(tagInput);
                setTagInput("");
              }
            }}
            placeholder={draftTags.length === 0 ? "Add tags…" : ""}
            className="h-5 min-w-[72px] flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/40"
          />
        </div>
      )}

      {/* Monaco editor — fills remaining space */}
      <div className="group/monaco relative min-h-0 flex-1">
        <SnippetMonaco
          ref={monacoRef}
          value={draftCode}
          onChange={mode === "edit" ? onCodeChange : undefined}
          language={effectiveLanguage}
          readOnly={mode === "view"}
          aria-label={t("editorAria")}
        />
        {draftCode && (
          <button
            type="button"
            onClick={handleCopy}
            className="absolute right-3 top-3 z-10 flex cursor-pointer items-center gap-1.5 rounded-md border border-border/60 bg-background/80 px-2.5 py-1.5 text-xs font-medium shadow-sm backdrop-blur-sm transition-opacity duration-150 hover:bg-muted opacity-0 group-hover/monaco:opacity-100"
          >
            {copied ? (
              <IconCheck className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <IconCopy className="h-3.5 w-3.5" />
            )}
            {copied ? t("copied") : t("copy")}
          </button>
        )}
      </div>
    </div>
  );

  // ── Empty state ───────────────────────────────────────────────────────────

  if (!selectedId && snippets.length === 0) {
    return (
      <ToolWrapper maxWidth="full" fillMain className="min-h-0">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
          <div className="flex items-center gap-2">
            <Button onClick={handleNew}>{t("newSnippet")}</Button>
            <ToolPinButton toolId="snippet-manager" className="h-9 w-9" />
          </div>
        </div>
      </ToolWrapper>
    );
  }

  // ── Mobile layout ─────────────────────────────────────────────────────────

  if (isMobile) {
    return (
      <ToolWrapper maxWidth="full" fillMain className="min-h-0">
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {/* Mobile top bar */}
          <div className="flex shrink-0 items-center gap-1.5">
            <Sheet open={listOpen} onOpenChange={setListOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted"
                >
                  <IconMenu2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate text-sm font-medium">
                    {draftTitle || t("snippets")}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {filtered.length}
                  </span>
                </button>
              </SheetTrigger>
              <SheetContent side="bottom" className="h-[75vh] rounded-t-2xl p-0">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <SheetTitle className="text-base">{t("snippets")}</SheetTitle>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-8 gap-1.5"
                    onClick={handleNew}
                  >
                    <IconPlus className="h-3.5 w-3.5" />
                    {t("newSnippet")}
                  </Button>
                </div>
                <div className="h-[calc(75vh-4rem)] p-4">{snippetList}</div>
              </SheetContent>
            </Sheet>
            <ToolPinButton toolId="snippet-manager" className="h-9 w-9 shrink-0" />
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-9 w-9 shrink-0 cursor-pointer"
              onClick={handleNew}
              aria-label={t("newSnippet")}
            >
              <IconPlus className="h-4 w-4" />
            </Button>
          </div>

          {/* Editor card */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/50">
            {editorPanel}
          </div>
        </div>

        <DeleteDialog
          target={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
          t={t}
        />
      </ToolWrapper>
    );
  }

  // ── Desktop layout ────────────────────────────────────────────────────────

  const snippetPanel = (
    <>
      {/* Header (icon, title, collapse) is owned by ToolSidebarLayout. */}
      <ToolSidebarActions>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 cursor-pointer"
          onClick={handleNew}
          aria-label={t("newSnippet")}
        >
          <IconPlus className="h-4 w-4" />
        </Button>
      </ToolSidebarActions>

              {/* Search */}
              <div className="shrink-0 px-3 py-2">
                <div className="relative">
                  <IconSearch className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("searchPlaceholder")}
                    className="h-7 pl-8 text-xs"
                    aria-label={t("searchAria")}
                  />
                </div>
              </div>

              {/* List */}
              <SnippetListContent
                scrollRef={snippetScrollRef}
                className="px-2"
                pinnedVisible={pinnedVisible}
                unpinnedVisible={unpinnedVisible}
                filtered={filtered}
                selectedId={selectedId}
                snHasMore={snHasMore}
                snDisplayCount={snDisplayCount}
                sentinelRef={snSentinelRef}
                t={t}
                onPin={handlePin}
                onSelect={(id) => {
                  debouncedSaveCode.flush();
                  setSelectedId(id);
                }}
              />

      {/* Count */}
      {filtered.length > 0 && (
        <div className="shrink-0 border-t border-border/50 px-3 py-2">
          <p className="text-center text-[11px] text-muted-foreground/60">
            {snHasMore ? `${snDisplayCount} / ${filtered.length}` : filtered.length}{" "}
            {filtered.length === 1 ? "snippet" : "snippets"}
          </p>
        </div>
      )}
    </>
  );

  return (
    <ToolSidebarLayout
      toolId="snippet-manager"
      icon={IconCode}
      title={t("snippets")}
      sidebar={snippetPanel}
    >
      <div className="flex min-h-0 flex-1 flex-col p-1 md:p-2">
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border/50 md:rounded-xl">
          {editorPanel}
        </div>
      </div>

      <DeleteDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        t={t}
      />
    </ToolSidebarLayout>
  );
}

