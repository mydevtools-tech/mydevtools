"use client";

import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, FileJson, FileSpreadsheet } from "lucide-react";
import { Task } from "@/app/app/to-do/types/Task";
import { Project } from "@/app/app/to-do/types/Project";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useStatuses } from "./hooks/useStatuses";
import { downloadFile } from "@/lib/desktop/save-file";
import { downloadWorkbook } from "@/lib/csv-excel-json-utils";

interface ExportImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: Task[];
  projects: Project[];
}

export default function ExportImportDialog({
  open,
  onOpenChange,
  tasks,
  projects,
}: ExportImportDialogProps) {
  const t = useTranslations("Tasks.export");
  const { statuses } = useStatuses();
  // Filter states
  const [selectedProject, setSelectedProject] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedTag, setSelectedTag] = useState<string>("all");

  // Derive unique values for filters
  const uniqueTags = Array.from(
    new Set(tasks.flatMap((t) => t.tags?.map((tag) => tag.name) || []))
  );

  // Helper to get project name
  const getProjectName = (projectId?: string) => {
    if (!projectId) return "";
    return projects.find((p) => p.id === projectId)?.name || t("unknownProject");
  };

  // Filter tasks
  const getFilteredTasks = () => {
    return tasks.filter((task) => {
      const matchesProject =
        selectedProject === "all" || task.projectId === selectedProject;
      const matchesStatus =
        selectedStatus === "all" || task.status === selectedStatus;
      const matchesTag =
        selectedTag === "all" ||
        task.tags?.some((t) => t.name === selectedTag);
      return matchesProject && matchesStatus && matchesTag;
    });
  };

  const exportToJSON = () => {
    const filteredTasks = getFilteredTasks();
    const dataStr = JSON.stringify(filteredTasks, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    downloadFile(dataBlob, `tasks-export-${new Date().toISOString().split("T")[0]}.json`);
    toast.success(t("toastExportedJson", { count: filteredTasks.length }));
  };

  const exportToCSV = () => {
    const filteredTasks = getFilteredTasks();
    if (filteredTasks.length === 0) {
      toast.error(t("toastNoTasks"));
      return;
    }

    const headers = [
      "ID",
      "Title",
      "Description",
      "Status",
      "Priority",
      "Due Date",
      "Created At",
      "Completed At",
      "Tags",
      "Time Estimate (min)",
      "Time Logged (min)",
      "Project Name",
    ];

    const rows = filteredTasks.map((task) => [
      task.id,
      `"${task.text.replace(/"/g, '""')}"`,
      `"${(task.description || "").replace(/"/g, '""')}"`,
      task.status,
      `"${(task.priority || "").replace(/"/g, '""')}"`,
      `"${(task.dueDate || "").replace(/"/g, '""')}"`,
      `"${(task.createdAt || "").replace(/"/g, '""')}"`,
      `"${(task.completedAt || "").replace(/"/g, '""')}"`,
      `"${(task.tags?.map((t) => t.name).join(";") || "").replace(/"/g, '""')}"`,
      task.timeEstimate || "",
      task.timeLogged || "",
      `"${getProjectName(task.projectId).replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    downloadFile(blob, `tasks-export-${new Date().toISOString().split("T")[0]}.csv`);
    toast.success(t("toastExportedCsv", { count: filteredTasks.length }));
  };

  const exportToExcel = async () => {
    try {
      const XLSX = await import("xlsx");
      const filteredTasks = getFilteredTasks();

      if (filteredTasks.length === 0) {
        toast.error(t("toastNoTasks"));
        return;
      }

      const rows = filteredTasks.map((task) => ({
        ID: task.id,
        Title: task.text,
        Description: task.description || "",
        Status: task.status,
        Priority: task.priority || "",
        "Due Date": task.dueDate || "",
        "Created At": task.createdAt,
        "Completed At": task.completedAt || "",
        Tags: task.tags?.map((t) => t.name).join("; ") || "",
        "Time Estimate (min)": task.timeEstimate || "",
        "Time Logged (min)": task.timeLogged || "",
        "Project Name": getProjectName(task.projectId),
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Tasks");

      await downloadWorkbook(workbook, `tasks-export-${new Date().toISOString().split("T")[0]}.xlsx`);
      toast.success(t("toastExportedExcel", { count: filteredTasks.length }));
    } catch (error) {
      console.error("Excel export error:", error);
      toast.error(t("toastFailedExcel"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("projectLabel")}</label>
              <select
                className="w-full p-2 rounded-md border bg-background"
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
              >
                <option value="all">{t("allProjects")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("statusLabel")}</label>
              <select
                className="w-full p-2 rounded-md border bg-background"
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
              >
                <option value="all">{t("allStatuses")}</option>
                {statuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("tagLabel")}</label>
              <select
                className="w-full p-2 rounded-md border bg-background"
                value={selectedTag}
                onChange={(e) => setSelectedTag(e.target.value)}
              >
                <option value="all">{t("allTags")}</option>
                {uniqueTags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="p-4 rounded-lg border bg-muted/50">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-primary/10">
                <FileJson className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold mb-1">{t("exportAsJsonTitle")}</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  {t("exportAsJsonDescription")}
                </p>
                <Button onClick={exportToJSON} className="gap-2">
                  <Download className="h-4 w-4" />
                  {t("exportJson")}
                </Button>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-lg border bg-muted/50">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-green-500/10">
                <FileSpreadsheet className="h-5 w-5 text-green-500" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold mb-1">{t("exportAsCsvExcelTitle")}</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  {t("exportAsCsvExcelDescription")}
                </p>
                <div className="flex gap-2">
                  <Button onClick={exportToCSV} variant="outline" className="gap-2">
                    <Download className="h-4 w-4" />
                    {t("exportCsv")}
                  </Button>
                  <Button onClick={exportToExcel} variant="outline" className="gap-2">
                    <Download className="h-4 w-4" />
                    {t("exportExcel")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

