"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { IconDownload } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { downloadFile } from "@/lib/desktop/save-file";
import { downloadWorkbook } from "@/lib/csv-excel-json-utils";

interface ExportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    documents: any[];
    fields: string[];
}

export function ExportDialog({ open, onOpenChange, documents, fields }: ExportDialogProps) {
    const t = useTranslations("NoSqlExplorer.export");
    const [selectedFields, setSelectedFields] = useState<string[]>(fields);
    const [format, setFormat] = useState<"xlsx" | "csv" | "tsv" | "json">("xlsx");

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedFields(fields);
        } else {
            setSelectedFields([]);
        }
    };

    const handleFieldToggle = (field: string, checked: boolean) => {
        if (checked) {
            setSelectedFields([...selectedFields, field]);
        } else {
            setSelectedFields(selectedFields.filter(f => f !== field));
        }
    };

    const handleExport = async () => {
        if (selectedFields.length === 0) {
            toast.error(t("selectFieldsError"));
            return;
        }

        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const filename = `export_${timestamp}.${format}`;

            if (format === "json") {
                // Keep nested values as real JSON, not stringified cells
                const rows = documents.map(doc => {
                    const newDoc: any = {};
                    selectedFields.forEach(field => { newDoc[field] = doc[field]; });
                    return newDoc;
                });
                const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
                downloadFile(blob, filename);
                toast.success(t("success", { filename }));
                onOpenChange(false);
                return;
            }

            const XLSX = await import("xlsx");

            const dataToExport = documents.map(doc => {
                const newDoc: any = {};
                selectedFields.forEach(field => {
                    const value = doc[field];
                    if (typeof value === 'object' && value !== null) {
                        newDoc[field] = JSON.stringify(value);
                    } else {
                        newDoc[field] = value;
                    }
                });
                return newDoc;
            });

            const worksheet = XLSX.utils.json_to_sheet(dataToExport);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, t("sheetName"));

            if (format === "csv") {
                await downloadWorkbook(workbook, filename, "csv");
            } else if (format === "tsv") {
                await downloadWorkbook(workbook, filename, "txt"); // txt = tab-separated
            } else {
                await downloadWorkbook(workbook, filename);
            }

            toast.success(t("success", { filename }));
            onOpenChange(false);
        } catch (error) {
            console.error("Export failed", error);
            toast.error(t("fail"));
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("title")}</DialogTitle>
                    <p className="text-xs text-muted-foreground">{t("pageOnlyNote", { count: documents.length })}</p>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="space-y-2">
                        <Label className="text-sm font-medium">{t("formatLabel")}</Label>
                        <RadioGroup value={format} onValueChange={(v) => setFormat(v as "xlsx" | "csv" | "tsv" | "json")} className="flex gap-4 flex-wrap">
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="xlsx" id="xlsx" />
                                <Label htmlFor="xlsx">{t("formatXlsx")}</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="csv" id="csv" />
                                <Label htmlFor="csv">{t("formatCsv")}</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="tsv" id="tsv" />
                                <Label htmlFor="tsv">{t("formatTsv")}</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="json" id="json" />
                                <Label htmlFor="json">{t("formatJson")}</Label>
                            </div>
                        </RadioGroup>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label className="text-sm font-medium">{t("selectFields")}</Label>
                            <div className="flex items-center space-x-2">
                                <Checkbox
                                    id="select-all"
                                    checked={selectedFields.length === fields.length}
                                    onCheckedChange={(checked) => handleSelectAll(checked as boolean)}
                                />
                                <Label htmlFor="select-all" className="text-xs text-muted-foreground font-normal">{t("selectAll")}</Label>
                            </div>
                        </div>
                        <div className="border rounded-md p-2">
                            <ScrollArea className="h-[200px]">
                                <div className="space-y-2">
                                    {fields.map(field => (
                                        <div key={field} className="flex items-center space-x-2">
                                            <Checkbox
                                                id={`field-${field}`}
                                                checked={selectedFields.includes(field)}
                                                onCheckedChange={(checked) => handleFieldToggle(field, checked as boolean)}
                                            />
                                            <Label htmlFor={`field-${field}`} className="text-sm font-normal cursor-pointer">
                                                {field}
                                            </Label>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </div>
                        <div className="text-xs text-muted-foreground text-right">
                            {t("fieldsSelected", { count: selectedFields.length })}
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
                    <Button onClick={handleExport}>
                        <IconDownload className="h-4 w-4 mr-2" />
                        {t("export")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
