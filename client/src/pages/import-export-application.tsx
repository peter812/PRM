import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Upload, FileText, AlertCircle, CheckCircle2, Download, Database, X } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface TaskStatus {
  id: string;
  type: string;
  status: string;
  progress: number;
  progressMessage: string | null;
  result: string | null;
}

function ProgressBar({ value, message }: { value: number; message?: string | null }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center text-xs text-muted-foreground">
        <span>{message || "Processing…"}</span>
        <span>{value}%</span>
      </div>
      <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function useTaskPoller(taskId: string | null, onComplete: (task: TaskStatus) => void, onError: (task: TaskStatus) => void) {
  const [task, setTask] = useState<TaskStatus | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!taskId) {
      setTask(null);
      return;
    }

    const poll = async () => {
      try {
        const response = await fetch(`/api/tasks/${taskId}`);
        if (!response.ok) return;
        const data: TaskStatus = await response.json();
        setTask(data);
        if (data.status === "completed") {
          if (intervalRef.current) clearInterval(intervalRef.current);
          onComplete(data);
        } else if (data.status === "failed") {
          if (intervalRef.current) clearInterval(intervalRef.current);
          onError(data);
        }
      } catch {}
    };

    poll();
    intervalRef.current = setInterval(poll, 2000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [taskId]);

  return task;
}

export default function ImportExportApplicationPage() {
  const [selectedXmlFile, setSelectedXmlFile] = useState<File | null>(null);
  const [includeHistory, setIncludeHistory] = useState(false);

  const [exportTaskId, setExportTaskId] = useState<string | null>(null);
  const [importTaskId, setImportTaskId] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ imported: Record<string, number>; skipped: Record<string, number> } | null>(null);
  const [exportDone, setExportDone] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const exportTask = useTaskPoller(
    exportTaskId,
    (task) => {
      setExportDone(true);
      const date = new Date().toISOString().split("T")[0];
      const a = document.createElement("a");
      a.href = `/api/tasks/${task.id}/download`;
      a.download = `crm-export-${date}.xml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast({ title: "Export Complete", description: "Your XML file is downloading." });
    },
    (task) => {
      toast({ title: "Export Failed", description: task.result || "Unknown error", variant: "destructive" });
      setExportTaskId(null);
    }
  );

  const importTask = useTaskPoller(
    importTaskId,
    (task) => {
      try {
        const parsed = JSON.parse(task.result || "{}");
        setImportResult(parsed);
      } catch {
        setImportResult(null);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      toast({ title: "Import Complete", description: "Your data has been imported." });
    },
    (task) => {
      toast({ title: "Import Failed", description: task.result || "Unknown error", variant: "destructive" });
      setImportTaskId(null);
    }
  );

  const startExportMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/tasks/export-xml", { includeHistory });
      return res.json();
    },
    onSuccess: (task) => {
      setExportTaskId(task.id);
      setExportDone(false);
    },
    onError: (error: Error) => {
      toast({ title: "Export Failed", description: error.message, variant: "destructive" });
    },
  });

  const startImportMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("xml", file);
      const response = await fetch("/api/tasks/import-xml", { method: "POST", body: formData });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to start import");
      }
      return response.json();
    },
    onSuccess: (task) => {
      setImportTaskId(task.id);
      setImportResult(null);
    },
    onError: (error: Error) => {
      toast({ title: "Import Failed", description: error.message, variant: "destructive" });
    },
  });

  const handleXmlFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith(".xml")) {
        toast({ title: "Invalid File", description: "Please select an XML file", variant: "destructive" });
        return;
      }
      setSelectedXmlFile(file);
    }
  };

  const clearImport = () => {
    setSelectedXmlFile(null);
    setImportTaskId(null);
    setImportResult(null);
    const fileInput = document.getElementById("xml-file-input") as HTMLInputElement;
    if (fileInput) fileInput.value = "";
  };

  const clearExport = () => {
    setExportTaskId(null);
    setExportDone(false);
  };

  const isExporting = exportTaskId !== null && !exportDone && exportTask?.status !== "failed";
  const isImporting = importTaskId !== null && importTask?.status !== "completed" && importTask?.status !== "failed";

  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Import &amp; Export Data
          </CardTitle>
          <CardDescription>Export all your CRM data or import a previously exported backup (XML format)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Export section */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Export All Data</Label>
              <p className="text-sm text-muted-foreground">
                Export all people, relationships, groups, interactions, notes, social accounts, and social account types to an XML file (images excluded)
              </p>
            </div>

            <div className="flex items-center justify-between rounded-md border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="app-include-history-toggle" className="text-sm font-medium">
                  Include Social Account History
                </Label>
                <p className="text-xs text-muted-foreground">
                  Include profile version history and network change data for social accounts
                </p>
              </div>
              <Switch
                id="app-include-history-toggle"
                checked={includeHistory}
                onCheckedChange={setIncludeHistory}
                disabled={isExporting}
                data-testid="switch-app-include-history"
              />
            </div>

            {isExporting && exportTask && (
              <div className="space-y-2 rounded-md border p-4">
                <ProgressBar value={exportTask.progress} message={exportTask.progressMessage} />
              </div>
            )}

            {exportDone && (
              <div className="flex items-center gap-3 rounded-md bg-primary/10 border border-primary/20 p-3">
                <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                <span className="text-sm flex-1" data-testid="text-export-done">Export complete — file downloading.</span>
                <Button size="icon" variant="ghost" onClick={clearExport} data-testid="button-dismiss-export">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                onClick={() => startExportMutation.mutate()}
                disabled={isExporting || startExportMutation.isPending}
                data-testid="button-export-xml"
                className="gap-2"
              >
                {isExporting || startExportMutation.isPending ? (
                  <>
                    <div className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                    Exporting…
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Export to XML
                  </>
                )}
              </Button>
              {exportDone && exportTask && (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    const date = new Date().toISOString().split("T")[0];
                    const a = document.createElement("a");
                    a.href = `/api/tasks/${exportTask.id}/download`;
                    a.download = `crm-export-${date}.xml`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                  }}
                  data-testid="button-redownload-xml"
                >
                  <Download className="h-4 w-4" />
                  Download Again
                </Button>
              )}
            </div>
          </div>

          {/* Import section */}
          <div className="border-t pt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="xml-file-input">Import from XML</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="xml-file-input"
                  type="file"
                  accept=".xml"
                  onChange={handleXmlFileChange}
                  disabled={isImporting || startImportMutation.isPending}
                  data-testid="input-xml-file"
                  className="cursor-pointer"
                />
              </div>
              {selectedXmlFile && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  <span data-testid="text-selected-xml-filename">{selectedXmlFile.name}</span>
                </div>
              )}
            </div>

            <div className="rounded-md bg-muted p-4 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p className="font-medium">Import Notes:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Only import files exported from this CRM application</li>
                    <li>Images are not included in imports</li>
                    <li>Importing will add data to your existing database</li>
                    <li>Duplicate IDs will be skipped</li>
                    <li>Includes people, relationships, groups, interactions, notes, social accounts, and social account types</li>
                  </ul>
                </div>
              </div>
            </div>

            {isImporting && importTask && (
              <div className="space-y-2 rounded-md border p-4">
                <ProgressBar value={importTask.progress} message={importTask.progressMessage} />
              </div>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              <Button
                onClick={() => { if (selectedXmlFile) startImportMutation.mutate(selectedXmlFile); }}
                disabled={!selectedXmlFile || isImporting || startImportMutation.isPending}
                data-testid="button-import-xml"
                className="gap-2"
              >
                {isImporting || startImportMutation.isPending ? (
                  <>
                    <div className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                    Importing…
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Import from XML
                  </>
                )}
              </Button>

              {(selectedXmlFile || importResult) && !isImporting && (
                <Button
                  variant="outline"
                  onClick={clearImport}
                  data-testid="button-clear-xml-file"
                >
                  Clear
                </Button>
              )}
            </div>

            {importResult && (
              <div className="rounded-md bg-primary/10 border border-primary/20 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium" data-testid="text-xml-import-success">Import Complete</p>
                    <p className="text-sm text-muted-foreground">
                      Imported:{" "}
                      {importResult.imported.people} people,{" "}
                      {importResult.imported.groups} groups,{" "}
                      {importResult.imported.relationships} relationships,{" "}
                      {importResult.imported.interactions} interactions,{" "}
                      {importResult.imported.notes} notes,{" "}
                      {importResult.imported.socialAccounts || 0} social accounts,{" "}
                      {importResult.imported.socialAccountTypes || 0} social account types,{" "}
                      {importResult.imported.posts || 0} posts
                    </p>
                    {importResult.skipped && Object.values(importResult.skipped).some(v => v > 0) && (
                      <p className="text-sm text-muted-foreground">
                        Skipped duplicates:{" "}
                        {Object.entries(importResult.skipped)
                          .filter(([, v]) => v > 0)
                          .map(([k, v]) => `${v} ${k}`)
                          .join(", ")}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
