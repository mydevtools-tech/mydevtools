"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/desktop/api-fetch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { IconRefresh, IconUpload, IconDownload, IconTrash, IconLoader2, IconFile } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { downloadFile } from "@/lib/desktop/save-file";

interface GridFsFile {
    id: unknown;
    filename?: string;
    length: number;
    uploadDate?: string;
}

function humanSize(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function GridFsBrowser({
    connectionString,
    dbName,
    name,
    readOnly = false,
    open,
    onClose,
}: {
    connectionString: string;
    dbName: string;
    name: string;
    readOnly?: boolean;
    open: boolean;
    onClose: () => void;
}) {
    const [files, setFiles] = useState<GridFsFile[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [dragging, setDragging] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const body = (extra: Record<string, unknown> = {}) =>
        JSON.stringify({ connectionString, dbName, ...extra });

    const load = async () => {
        setLoading(true);
        try {
            const res = await apiFetch("/api/nosql/gridfs/list", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: body(),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setFiles(data.files ?? []);
        } catch (e: any) {
            toast.error(e.message || "Failed to list files");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { if (open) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, connectionString, dbName]);

    const upload = async (file: File) => {
        setBusy("upload");
        try {
            const dataUrl: string = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(r.result as string);
                r.onerror = () => reject(new Error("read error"));
                r.readAsDataURL(file);
            });
            const b64 = dataUrl.split(",")[1] ?? "";
            const res = await apiFetch("/api/nosql/gridfs/upload", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: body({ filename: file.name, data: b64 }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            toast.success(`Uploaded ${file.name}`);
            void load();
        } catch (e: any) {
            toast.error(e.message || "Upload failed");
        } finally {
            setBusy(null);
        }
    };

    const download = async (f: GridFsFile) => {
        setBusy(String(f.id));
        try {
            const res = await apiFetch("/api/nosql/gridfs/download", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: body({ id: f.id }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            const bytes = Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0));
            downloadFile(new Blob([bytes]), f.filename || "gridfs-file");
        } catch (e: any) {
            toast.error(e.message || "Download failed");
        } finally {
            setBusy(null);
        }
    };

    const remove = async (f: GridFsFile) => {
        setBusy(String(f.id));
        try {
            const res = await apiFetch("/api/nosql/gridfs/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: body({ id: f.id }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            toast.success("File deleted");
            void load();
        } catch (e: any) {
            toast.error(e.message || "Delete failed");
        } finally {
            setBusy(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="max-w-2xl h-[75vh] flex flex-col p-0 gap-0">
                <DialogHeader className="px-4 py-3 border-b">
                    <DialogTitle className="text-sm font-medium flex items-center gap-2">
                        GridFS
                        <span className="text-muted-foreground font-mono text-xs truncate">{name}</span>
                    </DialogTitle>
                </DialogHeader>

                <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/20">
                    <span className="text-xs text-muted-foreground">{files ? `${files.length} file(s)` : ""}</span>
                    <div className="flex items-center gap-1.5">
                        {!readOnly && (
                            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy === "upload"} onClick={() => fileRef.current?.click()}>
                                {busy === "upload" ? <IconLoader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <IconUpload className="h-3.5 w-3.5 mr-1.5" />}
                                {"Upload"}
                            </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={load} disabled={loading}>
                            <IconRefresh className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                        </Button>
                        <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
                    </div>
                </div>

                <div
                    className={cn("flex-1 min-h-0 overflow-auto", dragging && !readOnly && "bg-primary/5 ring-2 ring-inset ring-primary")}
                    onDragOver={(e) => { if (!readOnly) { e.preventDefault(); setDragging(true); } }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setDragging(false); if (!readOnly) { const f = e.dataTransfer.files[0]; if (f) void upload(f); } }}
                >
                    {files && files.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
                            <IconFile className="h-8 w-8 opacity-40" />
                            {"No files"}
                            {!readOnly && <span className="text-xs">{"Drop files here to upload"}</span>}
                        </div>
                    ) : (
                        <table className="w-full text-xs">
                            <thead className="text-muted-foreground uppercase bg-muted sticky top-0">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">{"Name"}</th>
                                    <th className="px-3 py-2 text-right font-medium w-24">{"Size"}</th>
                                    <th className="px-3 py-2 text-right font-medium w-24" />
                                </tr>
                            </thead>
                            <tbody>
                                {(files ?? []).map((f, i) => {
                                    const rowBusy = busy === String(f.id);
                                    return (
                                        <tr key={i} className="border-b hover:bg-muted/40">
                                            <td className="px-3 py-2 font-mono truncate max-w-[300px]" title={f.filename}>{f.filename || "—"}</td>
                                            <td className="px-3 py-2 text-right font-mono text-muted-foreground">{humanSize(f.length)}</td>
                                            <td className="px-3 py-2 text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    <Button variant="ghost" size="icon" className="h-6 w-6" disabled={rowBusy} onClick={() => download(f)} title={"Download"}>
                                                        {rowBusy ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" /> : <IconDownload className="h-3.5 w-3.5" />}
                                                    </Button>
                                                    {!readOnly && (
                                                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" disabled={rowBusy} onClick={() => remove(f)} title={"Delete"}>
                                                            <IconTrash className="h-3.5 w-3.5" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
