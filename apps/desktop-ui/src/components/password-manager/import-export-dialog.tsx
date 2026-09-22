"use client"

import { useRef, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Upload, Download, FileJson, AlertTriangle, ShieldCheck } from "lucide-react"
import { usePasswordStore, PasswordEntry } from "@/store/password-store"
import { useMasterKeyStore } from "@/store/master-key-store"
import { toast } from "sonner"
import { createPasswordEntry } from "@/lib/password-manager-api"
import { encryptData } from "@/lib/encryption"
import { reauthenticate } from "@/lib/verify-master-password"
import {
    NeedsPassphraseError,
    encryptExport,
    parseImport,
    type ImportedEntry,
    type ParsedImport,
} from "@/lib/password-import"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useTranslations } from "next-intl"
import { downloadFile } from "@/lib/desktop/save-file"

interface ImportExportDialogProps {
    children?: React.ReactNode
}

type ExportMode = "encrypted" | "plaintext"

export function ImportExportDialog({ children }: ImportExportDialogProps) {
    const t = useTranslations("PasswordManager.importExport")
    const tToast = useTranslations("PasswordManager.toasts")
    const pastePlaceholder = String(t.raw("pastePlaceholder"))
    const { encryptionKey } = useMasterKeyStore()
    const { passwords, addPassword } = usePasswordStore()
    const [open, setOpen] = useState(false)
    const [importData, setImportData] = useState("")
    const [loading, setLoading] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Export
    const [exportMode, setExportMode] = useState<ExportMode>("encrypted")
    const [masterPassword, setMasterPassword] = useState("")
    const [exportPassphrase, setExportPassphrase] = useState("")
    const [exporting, setExporting] = useState(false)

    // Import
    const [importPassphrase, setImportPassphrase] = useState("")
    const [needsPassphrase, setNeedsPassphrase] = useState(false)
    const [preview, setPreview] = useState<ParsedImport | null>(null)

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        e.target.value = ""
        if (!file) return
        try {
            setImportData(await file.text())
            setPreview(null)
            setNeedsPassphrase(false)
        } catch {
            toast.error(t("toastImportFailed"))
        }
    }

    const download = (contents: string, suffix: string) => {
        const blob = new Blob([contents], { type: "application/json" })
        downloadFile(blob, `password-vault-export-${new Date().toISOString().split("T")[0]}${suffix}.json`)
    }

    /**
     * Export writes every credential the vault holds, so it re-authenticates
     * first: an unlocked vault on an unattended machine should not be one click
     * away from a complete plaintext copy.
     */
    const handleExport = async () => {
        if (!masterPassword) return
        setExporting(true)
        try {
            if (!(await reauthenticate(masterPassword))) {
                toast.error(tToast("wrongMasterPassword"))
                return
            }
            const entries: ImportedEntry[] = passwords.map((p) => ({
                service: p.service,
                username: p.username,
                password: p.password,
                url: p.url ?? "",
                notes: p.notes ?? "",
                tags: p.tags ?? [],
            }))

            if (exportMode === "encrypted") {
                if (exportPassphrase.length < 8) {
                    toast.error(t("passphraseTooShort"))
                    return
                }
                const envelope = await encryptExport(entries, exportPassphrase)
                download(JSON.stringify(envelope, null, 2), "-encrypted")
            } else {
                download(JSON.stringify(entries, null, 2), "")
            }
            setMasterPassword("")
            setExportPassphrase("")
            toast.success(t("toastExported"))
        } catch {
            toast.error(t("toastExportFailed"))
        } finally {
            setExporting(false)
        }
    }

    /** Parse and vet before anything is written, so the user sees what will
     *  happen — and so a bad file costs nothing. */
    const handlePreview = async () => {
        if (!importData.trim()) return
        setLoading(true)
        try {
            const parsed = await parseImport(
                importData,
                passwords,
                needsPassphrase ? importPassphrase : undefined
            )
            setPreview(parsed)
            setNeedsPassphrase(false)
        } catch (e) {
            if (e instanceof NeedsPassphraseError) {
                setNeedsPassphrase(true)
                setPreview(null)
            } else {
                setPreview(null)
                toast.error(t("toastImportFailed"))
            }
        } finally {
            setLoading(false)
        }
    }

    /**
     * There is no server-side batch, so this cannot be atomic. What it can do
     * is never lie about the outcome: entries are counted as they land, and a
     * failure part-way reports how many were written rather than a bare
     * "import failed" over a half-populated vault.
     */
    const handleImport = async () => {
        if (!preview || preview.entries.length === 0) return
        if (!encryptionKey) return

        setLoading(true)
        let imported = 0
        let failed = 0
        try {
            for (const entry of preview.entries) {
                const timestamp = Date.now()
                try {
                    const { encrypted, iv } = await encryptData(encryptionKey, JSON.stringify(entry))
                    const created = await createPasswordEntry({
                        encryptedData: encrypted,
                        iv,
                        createdAt: timestamp,
                        updatedAt: timestamp,
                    })
                    const newEntry: PasswordEntry = {
                        id: created.id,
                        ...entry,
                        createdAt: timestamp,
                        updatedAt: timestamp,
                    }
                    addPassword(newEntry)
                    imported++
                } catch {
                    // One bad row must not abandon the rest half-written.
                    failed++
                }
            }

            if (failed > 0) {
                toast.warning(tToast("importedPartial", { imported, failed }))
            } else {
                toast.success(tToast("importedCount", { count: imported }))
            }
            setOpen(false)
            setImportData("")
            setPreview(null)
            setImportPassphrase("")
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {children || (
                    <Button variant="outline" className="gap-2">
                        <FileJson className="h-4 w-4" /> {t("trigger")}
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>{t("title")}</DialogTitle>
                    <DialogDescription>{t("description")}</DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="export" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="export">{t("tabExport")}</TabsTrigger>
                        <TabsTrigger value="import">{t("tabImport")}</TabsTrigger>
                    </TabsList>

                    <TabsContent value="export" className="space-y-4 py-4">
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant={exportMode === "encrypted" ? "default" : "outline"}
                                className="flex-1 gap-2"
                                onClick={() => setExportMode("encrypted")}
                            >
                                <ShieldCheck className="h-4 w-4" /> {t("modeEncrypted")}
                            </Button>
                            <Button
                                type="button"
                                variant={exportMode === "plaintext" ? "default" : "outline"}
                                className="flex-1 gap-2"
                                onClick={() => setExportMode("plaintext")}
                            >
                                <AlertTriangle className="h-4 w-4" /> {t("modePlaintext")}
                            </Button>
                        </div>

                        {exportMode === "plaintext" && (
                            <Alert variant="destructive">
                                <AlertTriangle className="h-4 w-4" />
                                <AlertTitle>{t("warningTitle")}</AlertTitle>
                                <AlertDescription>{t("warningBody")}</AlertDescription>
                            </Alert>
                        )}

                        <div className="space-y-3 rounded-lg border p-4">
                            {exportMode === "encrypted" && (
                                <div className="space-y-2">
                                    <Label htmlFor="export-passphrase">{t("passphraseLabel")}</Label>
                                    <Input
                                        id="export-passphrase"
                                        type="password"
                                        value={exportPassphrase}
                                        onChange={(e) => setExportPassphrase(e.target.value)}
                                        autoComplete="new-password"
                                    />
                                    <p className="text-[11px] text-muted-foreground">
                                        {t("passphraseHint")}
                                    </p>
                                </div>
                            )}

                            <div className="space-y-2">
                                <Label htmlFor="export-master">{t("confirmMasterLabel")}</Label>
                                <Input
                                    id="export-master"
                                    type="password"
                                    value={masterPassword}
                                    onChange={(e) => setMasterPassword(e.target.value)}
                                    autoComplete="current-password"
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") void handleExport()
                                    }}
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    {t("confirmMasterHint")}
                                </p>
                            </div>

                            <Button
                                onClick={() => void handleExport()}
                                className="w-full"
                                disabled={exporting || !masterPassword || passwords.length === 0}
                            >
                                <Download className="mr-2 h-4 w-4" />
                                {t("downloadCount", { count: passwords.length })}
                            </Button>
                        </div>
                    </TabsContent>

                    <TabsContent value="import" className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>{t("pasteLabel")}</Label>
                            <Textarea
                                placeholder={pastePlaceholder}
                                className="h-[160px] font-mono text-xs"
                                value={importData}
                                onChange={(e) => {
                                    setImportData(e.target.value)
                                    setPreview(null)
                                }}
                            />
                            <p className="text-xs text-muted-foreground">{t("pasteHint")}</p>
                        </div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json,.csv,application/json,text/csv"
                            className="hidden"
                            onChange={handleFileSelect}
                        />
                        <Button variant="outline" className="w-full" onClick={() => fileInputRef.current?.click()}>
                            <FileJson className="mr-2 h-4 w-4" /> {t("selectFile")}
                        </Button>

                        {needsPassphrase && (
                            <div className="space-y-2">
                                <Label htmlFor="import-passphrase">{t("importPassphraseLabel")}</Label>
                                <Input
                                    id="import-passphrase"
                                    type="password"
                                    value={importPassphrase}
                                    onChange={(e) => setImportPassphrase(e.target.value)}
                                    autoComplete="off"
                                />
                            </div>
                        )}

                        {preview && (
                            <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
                                <p className="font-medium">{t("previewReady", { count: preview.entries.length })}</p>
                                {preview.duplicates > 0 && (
                                    <p className="text-xs text-muted-foreground">
                                        {t("previewDuplicates", { count: preview.duplicates })}
                                    </p>
                                )}
                                {preview.skipped > 0 && (
                                    <p className="text-xs text-muted-foreground">
                                        {t("previewSkipped", { count: preview.skipped })}
                                    </p>
                                )}
                            </div>
                        )}

                        <DialogFooter>
                            {preview ? (
                                <Button
                                    onClick={() => void handleImport()}
                                    disabled={loading || preview.entries.length === 0}
                                >
                                    {loading ? (
                                        t("importing")
                                    ) : (
                                        <>
                                            <Upload className="mr-2 h-4 w-4" />
                                            {t("confirmImport", { count: preview.entries.length })}
                                        </>
                                    )}
                                </Button>
                            ) : (
                                <Button onClick={() => void handlePreview()} disabled={loading || !importData}>
                                    {loading ? t("importing") : t("checkFile")}
                                </Button>
                            )}
                        </DialogFooter>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    )
}
