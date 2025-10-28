import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, FileText, AlertCircle, CheckCircle2, Download } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function AppOptionsPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedXmlFile, setSelectedXmlFile] = useState<File | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  return (
    <div className="container max-w-2xl py-8">
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
    </div>
  );
}
