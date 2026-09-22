"use client";

import { useCallback, useRef, useState } from "react";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useTranslations } from "next-intl";
import {
  IconCopy,
  IconDownload,
  IconFileSpreadsheet,
  IconFileTypeCsv,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ToolPinButton } from "@/components/tools/tool-header";
import { ToolShell } from "@/components/tools/tool-shell";
import { IOPanel, ToolTextArea } from "@/components/tools/io-panel";
import { cn } from "@/lib/utils";
import { downloadFile } from "@/lib/desktop/save-file";
import {
  csvTextToRows,
  excelBufferToRows,
  parseJsonToRows,
  rowsToCSV,
  rowsToXlsxFile,
} from "@/lib/csv-excel-json-utils";

const SAMPLE_JSON = `[
  { "name": "Ada", "role": "Engineer", "joined": "2024-01-15" },
  { "name": "Lin", "role": "Designer", "joined": "2024-06-01" }
]`;

export function CsvExcelJsonTool() {
  const t = useTranslations("CsvExcelJson");
  const [jsonText, setJsonText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const { isCopied: copied, copyToClipboard } = useCopyToClipboard();
  const fileRef = useRef<HTMLInputElement>(null);

  const applyRows = useCallback((rows: Record<string, unknown>[]) => {
    setJsonText(JSON.stringify(rows, null, 2));
    setError(null);
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      const name = file.name.toLowerCase();
      try {
        if (name.endsWith(".csv")) {
          const text = await file.text();
          const rows = csvTextToRows(text);
          applyRows(rows);
          toast.success(t("toastLoadedCsv"));
          return;
        }
        if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
          const buf = await file.arrayBuffer();
          const rows = await excelBufferToRows(buf);
          applyRows(rows);
          toast.success(t("toastLoadedExcel"));
          return;
        }
        toast.error(t("errors.unsupportedFile"));
      } catch (e) {
        const msg = e instanceof Error ? e.message : t("errors.parseFailed");
        setError(msg);
        toast.error(msg);
      }
    },
    [applyRows, t]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) void handleFile(f);
    },
    [handleFile]
  );

  const formatJson = () => {
    setError(null);
    try {
      const rows = parseJsonToRows(jsonText);
      setJsonText(JSON.stringify(rows, null, 2));
      toast.success(t("toastFormatted"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("errors.invalidJson");
      setError(msg);
      toast.error(msg);
    }
  };

  const downloadCsv = async () => {
    setError(null);
    try {
      const rows = parseJsonToRows(jsonText);
      const csv = rowsToCSV(rows);
      downloadFile(csv, t("filenames.csv"), "text/csv;charset=utf-8");
      toast.success(t("toastExportedCsv"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("errors.exportFailed");
      setError(msg);
      toast.error(msg);
    }
  };

  const downloadXlsx = async () => {
    setError(null);
    try {
      const rows = parseJsonToRows(jsonText);
      await rowsToXlsxFile(rows, t("sheetName"), t("filenames.xlsx"));
      toast.success(t("toastExportedXlsx"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("errors.exportFailed");
      setError(msg);
      toast.error(msg);
    }
  };

  const copyJson = () => {
    if (!jsonText.trim()) return;
    void copyToClipboard(jsonText, {
      successMessage: t("toastCopied"),
      errorMessage: t("errors.copyFailed"),
    });
  };

  const loadSample = () => {
    setJsonText(SAMPLE_JSON);
    setError(null);
  };

  return (
    <ToolShell
      icon={IconFileSpreadsheet}
      title={t("title")}
      description={t("subtitle")}
      toolbar={
        <div className="flex shrink-0 justify-end">
          <ToolPinButton toolId="csv-excel-json" />
        </div>
      }
      contentClassName="overflow-auto"
    >
      <div className="space-y-6">
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileRef.current?.click();
            }
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className={cn(
            "rounded-xl border-2 border-dashed p-8 text-center transition-colors",
            dragOver
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 bg-muted/20"
          )}
        >
          <IconFileSpreadsheet className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm font-medium mb-1">{t("dropTitle")}</p>
          <p className="text-xs text-muted-foreground mb-4">{t("dropHint")}</p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="secondary"
            className="gap-2"
            onClick={() => fileRef.current?.click()}
          >
            <IconUpload className="h-4 w-4" />
            {t("chooseFile")}
          </Button>
        </div>

        <IOPanel
          className="h-[320px]"
          bodyClassName="flex flex-col"
          label={t("jsonLabel")}
          actions={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={loadSample}
            >
              {t("loadSample")}
            </Button>
          }
        >
          <div className="relative min-h-0 flex-1">
            <ToolTextArea
              id="csv-json-textarea"
              aria-label={t("jsonLabel")}
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value);
                setError(null);
              }}
              placeholder={t("jsonPlaceholder")}
            />
          </div>
          {error && (
            <p
              className="shrink-0 border-t border-border/50 px-3 py-1.5 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}
        </IOPanel>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={formatJson}>
            {t("actions.format")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setJsonText("");
              setError(null);
            }}
          >
            <IconTrash className="h-4 w-4 mr-1.5" />
            {t("actions.clear")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={copyJson}>
            <IconCopy className="h-4 w-4 mr-1.5" />
            {copied ? t("actions.copied") : t("actions.copy")}
          </Button>
          <Button type="button" variant="default" size="sm" onClick={downloadCsv}>
            <IconFileTypeCsv className="h-4 w-4 mr-1.5" />
            {t("actions.downloadCsv")}
          </Button>
          <Button type="button" variant="default" size="sm" onClick={downloadXlsx}>
            <IconDownload className="h-4 w-4 mr-1.5" />
            {t("actions.downloadXlsx")}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("footnote")}
        </p>
      </div>
    </ToolShell>
  );
}
