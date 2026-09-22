"use client";

import { apiFetch } from "@/lib/desktop/api-fetch";
import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { ExportedKey } from "./bulk-types";
import { downloadFile } from "@/lib/desktop/save-file";

export function BulkExportDialog({
    open,
    onOpenChange,
    redisUrl,
    db,
}: {
    open: boolean;
    onOpenChange: (b: boolean) => void;
    redisUrl: string;
    db: number;
}) {
    const [pattern, setPattern] = useState("*");
    const [busy, setBusy] = useState(false);

    async function run() {
        setBusy(true);
        try {
            const res = await apiFetch("/api/redis-commander/export", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ redisUrl, db, pattern: pattern.trim() || "*" }),
            });
            const body = await res.json() as { keys?: ExportedKey[]; count?: number; truncated?: boolean; error?: string };
            if (body.error) throw new Error(body.error);
            const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
            downloadFile(blob, `redis-export-db${db}-${Date.now()}.json`);
            toast.success(`Exported ${body.count ?? 0} key(s)${body.truncated ? " (truncated)" : ""}`);
            onOpenChange(false);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Export failed");
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Export Keys to JSON</DialogTitle>
                </DialogHeader>
                <div className="space-y-2 py-1">
                    <Label className="text-xs">Pattern</Label>
                    <Input
                        value={pattern}
                        onChange={(e) => setPattern(e.target.value)}
                        placeholder="* = everything (capped at 10,000)"
                        className="h-8 text-xs font-mono"
                    />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        Cancel
                    </Button>
                    <Button onClick={run} disabled={busy}>
                        {busy ? "Exporting…" : "Download"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
