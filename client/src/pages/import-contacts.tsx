import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, FileText, AlertCircle, CheckCircle2, Contact } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function ImportContactsPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedVcfFile, setSelectedVcfFile] = useState<File | null>(null);
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
      queryClient.invalidateQueries({ queryKey: ["/api/people/paginated"] });

      toast({
        title: "Import Successful",
        description: `Successfully imported ${data.imported} contacts${data.errors > 0 ? ` with ${data.errors} errors` : ""}`,
      });

      setSelectedFile(null);

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

  const importVcfMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("vcf", file);

      const response = await fetch("/api/import-vcf", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to import VCF");
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people/paginated"] });

      toast({
        title: "Import Successful",
        description: `Successfully imported ${data.imported} contacts${data.errors > 0 ? ` with ${data.errors} errors` : ""}`,
      });

      setSelectedVcfFile(null);

      const fileInput = document.getElementById("vcf-file-input") as HTMLInputElement;
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

  const handleVcfFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith(".vcf")) {
        toast({
          title: "Invalid File",
          description: "Please select a VCF file",
          variant: "destructive",
        });
        return;
      }
      setSelectedVcfFile(file);
    }
  };

  const handleImport = () => {
    if (selectedFile) {
      importMutation.mutate(selectedFile);
    }
  };

  const handleVcfImport = () => {
    if (selectedVcfFile) {
      importVcfMutation.mutate(selectedVcfFile);
    }
  };

  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Import Contacts from CSV</CardTitle>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 flex-wrap">
            <Contact className="h-5 w-5" />
            Import Contacts from VCF (Apple Contacts)
          </CardTitle>
          <CardDescription>Import people from an Apple-formatted VCF (vCard) file. Supports files with multiple contacts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="vcf-file-input">Select VCF File</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="vcf-file-input"
                  type="file"
                  accept=".vcf"
                  onChange={handleVcfFileChange}
                  disabled={importVcfMutation.isPending}
                  data-testid="input-vcf-file"
                  className="cursor-pointer"
                />
              </div>
              {selectedVcfFile && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  <span data-testid="text-selected-vcf-filename">{selectedVcfFile.name}</span>
                </div>
              )}
            </div>

            <div className="rounded-md bg-muted p-4 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p className="font-medium">VCF Format Notes:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Supports Apple vCard 3.0 format exported from iOS/macOS</li>
                    <li>Files can contain one or many contacts</li>
                    <li>Name, email, phone, company, and title are mapped directly</li>
                    <li>Birthday, address, website, and other fields are stored in notes</li>
                    <li>Extra phone numbers and emails beyond the first are also added to notes</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleVcfImport}
                disabled={!selectedVcfFile || importVcfMutation.isPending}
                data-testid="button-import-vcf"
                className="gap-2"
              >
                {importVcfMutation.isPending ? (
                  <>
                    <div className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Import VCF
                  </>
                )}
              </Button>

              {selectedVcfFile && !importVcfMutation.isPending && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedVcfFile(null);
                    const fileInput = document.getElementById("vcf-file-input") as HTMLInputElement;
                    if (fileInput) {
                      fileInput.value = "";
                    }
                  }}
                  data-testid="button-clear-vcf-file"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>

          {importVcfMutation.isSuccess && importVcfMutation.data && (
            <div className="rounded-md bg-primary/10 border border-primary/20 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium" data-testid="text-vcf-import-success">
                    Import Complete
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Imported {importVcfMutation.data.imported} contact{importVcfMutation.data.imported !== 1 ? "s" : ""}
                    {importVcfMutation.data.errors > 0 && (
                      <span className="text-destructive ml-1">
                        ({importVcfMutation.data.errors} error{importVcfMutation.data.errors !== 1 ? "s" : ""})
                      </span>
                    )}
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
