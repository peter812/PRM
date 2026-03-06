import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Upload, FileText, AlertCircle, CheckCircle2, Download, Database } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function ImportExportApplicationPage() {
  const [selectedXmlFile, setSelectedXmlFile] = useState<File | null>(null);
  const [includeHistory, setIncludeHistory] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
      queryClient.invalidateQueries({ queryKey: ["/api/people/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      const imported = data.imported;
      const skipped = data.skipped || { people: 0, relationshipTypes: 0, interactionTypes: 0 };

      const importSummary = [
        `${imported.people} people${skipped.people > 0 ? ` (${skipped.people} duplicates skipped)` : ''}`,
        `${imported.relationships} relationships`,
        `${imported.relationshipTypes} relationship types${skipped.relationshipTypes > 0 ? ` (${skipped.relationshipTypes} duplicates skipped)` : ''}`,
        `${imported.interactions} interactions`,
        `${imported.interactionTypes} interaction types${skipped.interactionTypes > 0 ? ` (${skipped.interactionTypes} duplicates skipped)` : ''}`,
        `${imported.groups} groups`,
        `${imported.notes} notes`,
        `${imported.socialAccounts || 0} social accounts`,
        `${imported.socialAccountTypes || 0} social account types`,
      ].join(', ');

      toast({
        title: "Import Successful",
        description: `Successfully imported: ${importSummary}`,
      });

      setSelectedXmlFile(null);

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
      const params = new URLSearchParams();
      if (includeHistory) {
        params.set("includeHistory", "true");
      }
      const exportUrl = `/api/export-xml${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(exportUrl, {
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
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Import & Export Data
          </CardTitle>
          <CardDescription>Export all your CRM data or import a previously exported backup (XML format)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
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
                data-testid="switch-app-include-history"
              />
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
                    <li>Includes people, relationships, groups, interactions, notes, social accounts, and social account types</li>
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
                    {" "}{importXmlMutation.data.imported.notes} notes,
                    {" "}{importXmlMutation.data.imported.socialAccounts || 0} social accounts,
                    {" "}{importXmlMutation.data.imported.socialAccountTypes || 0} social account types
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
