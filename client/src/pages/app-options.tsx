import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Upload, FileText, AlertCircle, CheckCircle2, Download, Trash2, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

export default function AppOptionsPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedXmlFile, setSelectedXmlFile] = useState<File | null>(null);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [confirmSliderValue, setConfirmSliderValue] = useState([0]);
  const [includeExamples, setIncludeExamples] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("csv", file);

      const response = await fetch("/api/import-csv", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to import CSV");
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      
      toast({
        title: "Import Successful",
        description: `Successfully imported ${data.imported} contacts${data.errors > 0 ? ` with ${data.errors} errors` : ""}`,
      });

      setSelectedFile(null);
      
      // Reset file input
      const fileInput = document.getElementById("csv-file-input") as HTMLInputElement;
      if (fileInput) {
        fileInput.value = "";
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith(".csv")) {
        toast({
          title: "Invalid File",
          description: "Please select a CSV file",
          variant: "destructive",
        });
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleImport = () => {
    if (selectedFile) {
      importMutation.mutate(selectedFile);
    }
  };

  const importXmlMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("xml", file);

      const response = await fetch("/api/import-xml", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to import XML");
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      
      toast({
        title: "Import Successful",
        description: `Successfully imported data: ${data.imported.people} people, ${data.imported.groups} groups, ${data.imported.interactions} interactions, ${data.imported.notes} notes`,
      });

      setSelectedXmlFile(null);
      
      // Reset file input
      const fileInput = document.getElementById("xml-file-input") as HTMLInputElement;
      if (fileInput) {
        fileInput.value = "";
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleXmlFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith(".xml")) {
        toast({
          title: "Invalid File",
          description: "Please select an XML file",
          variant: "destructive",
        });
        return;
      }
      setSelectedXmlFile(file);
    }
  };

  const handleXmlImport = () => {
    if (selectedXmlFile) {
      importXmlMutation.mutate(selectedXmlFile);
    }
  };

  const handleExportXml = async () => {
    try {
      const response = await fetch("/api/export-xml", {
        method: "GET",
      });

      if (!response.ok) {
        throw new Error("Failed to export data");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `crm_export_${new Date().toISOString().split('T')[0]}.xml`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Export Successful",
        description: "Your data has been exported successfully",
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: error instanceof Error ? error.message : "Failed to export data",
        variant: "destructive",
      });
    }
  };

  const resetDatabaseMutation = useMutation({
    mutationFn: async ({ includeExamples }: { includeExamples: boolean }) => {
      const response = await fetch("/api/reset-database", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ includeExamples }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to reset database");
      }

      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Database Reset Complete",
        description: "Your database has been reset successfully. You can now create a new account.",
      });

      // Close dialog and reset form
      setIsResetDialogOpen(false);
      setConfirmSliderValue([0]);
      setIncludeExamples(false);

      // Invalidate all queries to refresh data
      queryClient.invalidateQueries();

      // Redirect to welcome page after a brief delay since session was destroyed and user creation is enabled
      setTimeout(() => {
        window.location.href = "/welcome";
      }, 1500);
    },
    onError: (error: Error) => {
      toast({
        title: "Reset Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleResetDatabase = () => {
    if (confirmSliderValue[0] < 100) {
      toast({
        title: "Confirmation Required",
        description: "Please slide the confirmation slider all the way to the right",
        variant: "destructive",
      });
      return;
    }

    resetDatabaseMutation.mutate({
      includeExamples,
    });
  };

  return (
    <div className="container max-w-2xl py-8 pl-12">
      <Card>
        <CardHeader>
          <CardTitle>Import Contacts</CardTitle>
          <CardDescription>Import people from a CSV file (Google Contacts format)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="csv-file-input">Select CSV File</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="csv-file-input"
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  disabled={importMutation.isPending}
                  data-testid="input-csv-file"
                  className="cursor-pointer"
                />
              </div>
              {selectedFile && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  <span data-testid="text-selected-filename">{selectedFile.name}</span>
                </div>
              )}
            </div>

            <div className="rounded-md bg-muted p-4 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p className="font-medium">CSV Format Notes:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>First data row is always skipped (example/header row)</li>
                    <li>First Name and Last Name are required</li>
                    <li>First email and phone are used as primary contact info</li>
                    <li>Additional phones, emails, and other data are added to notes</li>
                    <li>Tags/Labels are automatically parsed</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleImport}
                disabled={!selectedFile || importMutation.isPending}
                data-testid="button-import-csv"
                className="gap-2"
              >
                {importMutation.isPending ? (
                  <>
                    <div className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Import Contacts
                  </>
                )}
              </Button>
              
              {selectedFile && !importMutation.isPending && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedFile(null);
                    const fileInput = document.getElementById("csv-file-input") as HTMLInputElement;
                    if (fileInput) {
                      fileInput.value = "";
                    }
                  }}
                  data-testid="button-clear-file"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>

          {importMutation.isSuccess && importMutation.data && (
            <div className="rounded-md bg-primary/10 border border-primary/20 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium" data-testid="text-import-success">
                    Import Complete
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Imported {importMutation.data.imported} contact{importMutation.data.imported !== 1 ? "s" : ""}
                    {importMutation.data.errors > 0 && (
                      <span className="text-destructive ml-1">
                        ({importMutation.data.errors} error{importMutation.data.errors !== 1 ? "s" : ""})
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Import & Export Data</CardTitle>
          <CardDescription>Export all your CRM data or import a previously exported backup (XML format)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Export Section */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Export All Data</Label>
              <p className="text-sm text-muted-foreground">
                Export all people, relationships, groups, interactions, and notes to an XML file (images excluded)
              </p>
            </div>
            <Button
              onClick={handleExportXml}
              data-testid="button-export-xml"
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Export to XML
            </Button>
          </div>

          <div className="border-t pt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="xml-file-input">Import from XML</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="xml-file-input"
                  type="file"
                  accept=".xml"
                  onChange={handleXmlFileChange}
                  disabled={importXmlMutation.isPending}
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
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleXmlImport}
                disabled={!selectedXmlFile || importXmlMutation.isPending}
                data-testid="button-import-xml"
                className="gap-2"
              >
                {importXmlMutation.isPending ? (
                  <>
                    <div className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Import from XML
                  </>
                )}
              </Button>
              
              {selectedXmlFile && !importXmlMutation.isPending && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedXmlFile(null);
                    const fileInput = document.getElementById("xml-file-input") as HTMLInputElement;
                    if (fileInput) {
                      fileInput.value = "";
                    }
                  }}
                  data-testid="button-clear-xml-file"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>

          {importXmlMutation.isSuccess && importXmlMutation.data && (
            <div className="rounded-md bg-primary/10 border border-primary/20 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium" data-testid="text-xml-import-success">
                    Import Complete
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Imported: {importXmlMutation.data.imported.people} people, 
                    {" "}{importXmlMutation.data.imported.groups} groups,
                    {" "}{importXmlMutation.data.imported.relationships} relationships,
                    {" "}{importXmlMutation.data.imported.interactions} interactions,
                    {" "}{importXmlMutation.data.imported.notes} notes
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6 border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Reset Database</CardTitle>
          <CardDescription>Remove all tables from database and reinstall</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 text-destructive" />
              <div className="space-y-1 text-sm">
                <p className="font-medium text-destructive">Warning: This action cannot be undone</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>All existing data will be permanently deleted</li>
                  <li>All tables will be dropped and recreated</li>
                  <li>Default relationship and interaction types will be restored</li>
                  <li>A new "Me" person entry will be created for your user account</li>
                  <li>Optionally add example people and groups for testing</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="include-examples" className="text-base font-medium">
                Add Example Data
              </Label>
              <p className="text-sm text-muted-foreground">
                Include 6 example people and 2 groups in the reset
              </p>
            </div>
            <Switch
              id="include-examples"
              checked={includeExamples}
              onCheckedChange={setIncludeExamples}
              data-testid="switch-include-examples"
            />
          </div>

          <Button
            variant="destructive"
            onClick={() => setIsResetDialogOpen(true)}
            className="gap-2"
            data-testid="button-reset-database"
          >
            <Trash2 className="h-4 w-4" />
            Reset Database
          </Button>
        </CardContent>
      </Card>

      <Dialog open={isResetDialogOpen} onOpenChange={(open) => {
        setIsResetDialogOpen(open);
        if (!open) {
          setConfirmSliderValue([0]);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Confirm Database Reset</DialogTitle>
            <DialogDescription>
              This will permanently delete all your data. Slide to confirm.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  Slide to confirm
                </Label>
                <span className="text-xs text-muted-foreground">
                  {confirmSliderValue[0]}%
                </span>
              </div>
              <div className="relative">
                <Slider
                  value={confirmSliderValue}
                  onValueChange={setConfirmSliderValue}
                  max={100}
                  step={1}
                  disabled={resetDatabaseMutation.isPending}
                  data-testid="slider-confirm-reset"
                  className="w-full"
                />
                <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                  <span>Cancel</span>
                  <div className="flex items-center gap-1">
                    <span className={confirmSliderValue[0] === 100 ? "text-destructive font-medium" : ""}>
                      Confirm Reset
                    </span>
                    <ChevronRight className="h-3 w-3" />
                  </div>
                </div>
              </div>
            </div>

            {includeExamples && (
              <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                <p className="font-medium mb-1">Example data will include:</p>
                <ul className="list-disc list-inside space-y-0.5 text-xs">
                  <li>6 example people (Sarah Johnson, Michael Chen, Emily Rodriguez, David Thompson, Jessica Williams, Alex Martinez)</li>
                  <li>2 example groups (Work Team, Close Friends)</li>
                </ul>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsResetDialogOpen(false);
                setConfirmSliderValue([0]);
              }}
              disabled={resetDatabaseMutation.isPending}
              data-testid="button-cancel-reset"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleResetDatabase}
              disabled={
                resetDatabaseMutation.isPending ||
                confirmSliderValue[0] < 100
              }
              data-testid="button-confirm-reset"
            >
              {resetDatabaseMutation.isPending ? (
                <>
                  <div className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin mr-2" />
                  Resetting...
                </>
              ) : (
                "Reset Database"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
