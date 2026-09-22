"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/desktop/api-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { IconAlertTriangle, IconDownload, IconSearch, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { QueryResult, SchemaInfo } from "./types";
import type { AnySqlConfig } from "@/lib/data-explorer/sql-api";
import { sqlBody } from "@/lib/sql-request";
import { downloadFile } from "@/lib/desktop/save-file";

/**
 * A BLOB the server could not decode as text. Rust sends hex plus the true
 * byte length rather than lossy UTF-8, so the grid can say what the value is
 * without pretending it is a string. Returns null for any other object.
 */
export function formatBinary(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const v = value as Record<string, unknown>;
    if (typeof v.$binary !== "string" || typeof v.length !== "number") return null;
    const head = v.$binary.slice(0, 32);
    return `0x${head}${v.$binary.length > 32 ? "…" : ""} (${v.length} B)`;
}

interface ResultsTableProps {
    result: QueryResult;
    /** Present when the result is a plain table select — enables cell editing. */
    editable?: { config: AnySqlConfig; schema: string; table: string };
}

export function ResultsTable({ result, editable }: ResultsTableProps) {
    const t = useTranslations("SqlClient.results");
    const [filter, setFilter] = useState("");
    // Primary-key columns for the edited table; [] = no PK (editing disabled).
    const [pkCols, setPkCols] = useState<string[]>([]);
    // Committed edits, keyed by original row index then column index — result
    // props stay immutable, and column *index* is the identity because two
    // result columns can share a name.
    const [overrides, setOverrides] = useState<Record<number, Record<number, unknown>>>({});
    const [editing, setEditing] = useState<{ row: number; col: number } | null>(null);
    const [editValue, setEditValue] = useState("");
    const [saving, setSaving] = useState(false);
    const editInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!editable) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await apiFetch("/api/sql-client/tables", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(sqlBody(editable.config)),
                });
                if (!res.ok) return;
                const schema = (await res.json()) as SchemaInfo;
                if (cancelled) return;
                const pks = (schema.primaryKeys ?? [])
                    .filter(
                        (pk) =>
                            pk.table_name === editable.table &&
                            (!editable.schema || !pk.schema || pk.schema === editable.schema),
                    )
                    .map((pk) => pk.column_name);
                setPkCols(pks);
            } catch {
                // No PK info → editing stays disabled; the grid still renders.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [editable]);

    useEffect(() => {
        if (editing) editInputRef.current?.focus();
    }, [editing]);

    // New result rows → old index-keyed edits no longer apply.
    useEffect(() => {
        setOverrides({});
        setEditing(null);
    }, [result]);

    const cellValue = (origIdx: number, colIdx: number): unknown => {
        const o = overrides[origIdx];
        return o && colIdx in o ? o[colIdx] : result.rows[origIdx]?.[colIdx];
    };

    // Filter over effective (edited) values, carrying original indexes.
    const indexedRows = result.rows.map((_, i) => i);
    const filteredIdx = filter
        ? indexedRows.filter((i) =>
              result.columns.some((_, colIdx) =>
                  String(cellValue(i, colIdx) ?? "").toLowerCase().includes(filter.toLowerCase()),
              ),
          )
        : indexedRows;

    // Positions of the PK columns in this result. A PK missing from the
    // projection (`SELECT name FROM users`) leaves no way to identify a row.
    const pkIdx = useMemo(
        () => pkCols.map((pk) => result.columns.indexOf(pk)),
        [pkCols, result.columns],
    );
    const canEdit = !!editable && pkIdx.length > 0 && pkIdx.every((i) => i >= 0);

    /**
     * `newValue` is always the literal text typed, or `null` from the explicit
     * NULL button. There is deliberately no "looks like a number, send a
     * number" step: the server coerces text to the column's own type, and
     * guessing here made the string `"null"` impossible to enter and broke
     * text columns that happen to hold digits.
     */
    const commitEdit = async (origIdx: number, colIdx: number, newValue: unknown) => {
        if (!editable || saving) return;
        const current = cellValue(origIdx, colIdx);
        if (newValue === current) {
            setEditing(null);
            return;
        }
        setSaving(true);
        try {
            const where: Record<string, unknown> = {};
            pkCols.forEach((pk, n) => {
                where[pk] = cellValue(origIdx, pkIdx[n]);
            });
            const res = await apiFetch("/api/sql-client/update-row", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(
                    sqlBody(editable.config, {
                        schema: editable.schema,
                        table: editable.table,
                        set: { [result.columns[colIdx]]: newValue },
                        where,
                    }),
                ),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            const rowCount = Number(data.rowCount ?? 0);
            if (rowCount === 1) {
                // Only commit the local override once the server confirms the
                // write; a rolled-back update must not show as applied.
                setOverrides((prev) => ({
                    ...prev,
                    [origIdx]: { ...prev[origIdx], [colIdx]: newValue },
                }));
                toast.success(t("toastRowUpdated"));
            } else if (rowCount === 0) {
                toast.warning(t("toastRowNotFound"));
            } else {
                toast.error(t("toastRowsMatched", { count: rowCount }));
            }
            setEditing(null);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    const handleExportCSV = () => {
        const header = result.columns.join(",");
        const rows = indexedRows.map((i) =>
            result.columns
                .map((_, colIdx) => {
                    const val = cellValue(i, colIdx);
                    const str = val == null ? "" : typeof val === "object" ? JSON.stringify(val) : String(val);
                    return `"${str.replace(/"/g, '""')}"`;
                })
                .join(",")
        );
        const csv = [header, ...rows].join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        downloadFile(blob, "query-results.csv");
    };

    const formatCell = (value: unknown): string => {
        if (value === null || value === undefined) return "NULL";
        if (typeof value === "object") return formatBinary(value) ?? JSON.stringify(value);
        return String(value);
    };

    return (
        <div className="flex flex-col h-full">
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0 bg-muted/30">
                <div className="relative flex-1 max-w-xs">
                    <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                        className="h-7 pl-8 pr-7 text-xs"
                        placeholder={t("filterPlaceholder")}
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                    />
                    {filter && (
                        <button
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            onClick={() => setFilter("")}
                        >
                            <IconX className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>

                <span className="text-xs text-muted-foreground ml-auto">
                    {canEdit && <span className="mr-2 opacity-70">{t("editHint")}</span>}
                    {filteredIdx.length !== result.rows.length
                        ? t("rowCountFiltered", { filtered: filteredIdx.length, total: result.rows.length })
                        : t("rowCount", { count: result.rowCount })}{" "}
                    · {result.executionTime}ms
                </span>

                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleExportCSV}>
                    <IconDownload className="w-3.5 h-3.5" />
                    {t("exportCsv")}
                </Button>
            </div>

            {/*
              * Without this the grid shows N rows and the count claims millions,
              * which reads as "that is the whole table".
              */}
            {result.truncated && (
                <div className="flex items-center gap-2 border-b bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
                    <IconAlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    {t("truncated", { shown: result.rows.length, total: result.rowCount })}
                </div>
            )}

            {/* Table */}
            <ScrollArea className="flex-1 min-h-0">
                <div className="min-w-max">
                    <table className="w-full text-xs border-collapse">
                        <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                            <tr>
                                <th className="w-10 px-2 py-1.5 text-left font-medium text-muted-foreground border-b border-r select-none">
                                    #
                                </th>
                                {result.columns.map((col, colIdx) => (
                                    <th
                                        // Two result columns can share a name; the position is the identity.
                                        key={colIdx}
                                        className="px-3 py-1.5 text-left font-medium border-b border-r whitespace-nowrap font-mono"
                                    >
                                        {col}
                                        {canEdit && pkIdx.includes(colIdx) && (
                                            <span className="ml-1 text-[9px] text-muted-foreground align-top">PK</span>
                                        )}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredIdx.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={result.columns.length + 1}
                                        className="text-center py-8 text-muted-foreground"
                                    >
                                        {t("noRows")}
                                    </td>
                                </tr>
                            ) : (
                                filteredIdx.map((origIdx, displayIdx) => (
                                    <tr key={origIdx} className="hover:bg-muted/40 group">
                                        <td className="px-2 py-1 text-muted-foreground border-b border-r text-right select-none tabular-nums">
                                            {displayIdx + 1}
                                        </td>
                                        {result.columns.map((_, colIdx) => {
                                            const val = cellValue(origIdx, colIdx);
                                            const isNull = val === null || val === undefined;
                                            const isEditing = editing?.row === origIdx && editing?.col === colIdx;
                                            if (isEditing) {
                                                return (
                                                    <td key={colIdx} className="p-0 border-b border-r max-w-[300px]">
                                                        <div className="flex items-center">
                                                            <Input
                                                                ref={editInputRef}
                                                                className="h-6 rounded-none border-primary text-xs font-mono px-2"
                                                                value={editValue}
                                                                disabled={saving}
                                                                onChange={(e) => setEditValue(e.target.value)}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === "Enter") void commitEdit(origIdx, colIdx, editValue);
                                                                    if (e.key === "Escape") setEditing(null);
                                                                }}
                                                                onBlur={() => { if (!saving) setEditing(null); }}
                                                            />
                                                            {/* Typing "null" stores the string "null"; SQL NULL
                                                                needs its own affordance or it is unreachable. */}
                                                            <button
                                                                type="button"
                                                                disabled={saving}
                                                                title={t("setNull")}
                                                                // onMouseDown: the input's onBlur would close the
                                                                // editor before a click ever landed.
                                                                onMouseDown={(e) => {
                                                                    e.preventDefault();
                                                                    void commitEdit(origIdx, colIdx, null);
                                                                }}
                                                                className="h-6 shrink-0 border-y border-r border-primary px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                                                            >
                                                                NULL
                                                            </button>
                                                        </div>
                                                    </td>
                                                );
                                            }
                                            return (
                                                <td
                                                    key={colIdx}
                                                    className="px-3 py-1 border-b border-r max-w-[300px] truncate font-mono"
                                                    title={isNull ? "NULL" : String(val)}
                                                    onDoubleClick={() => {
                                                        // PK cells are the row identity — not editable in place.
                                                        if (!canEdit || pkIdx.includes(colIdx)) return;
                                                        // The cell shows a hex summary of a BLOB, not its
                                                        // contents. Committing that text back would overwrite
                                                        // the blob with a description of itself.
                                                        if (formatBinary(val)) return;
                                                        setEditing({ row: origIdx, col: colIdx });
                                                        setEditValue(isNull ? "" : formatCell(val));
                                                    }}
                                                >
                                                    {isNull ? (
                                                        <span className="text-muted-foreground/50 italic">NULL</span>
                                                    ) : (
                                                        <span
                                                            className={
                                                                typeof val === "boolean"
                                                                    ? "text-blue-500"
                                                                    : typeof val === "number"
                                                                    ? "text-orange-500"
                                                                    : ""
                                                            }
                                                        >
                                                            {formatCell(val)}
                                                        </span>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </ScrollArea>
        </div>
    );
}
