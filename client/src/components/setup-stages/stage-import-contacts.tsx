import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  FileSpreadsheet,
  Contact,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  Users,
} from "lucide-react";

export function StageImportContacts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedCsvFile, setSelectedCsvFile] = useState<File | null>(null);
  const [selectedVcfFile, setSelectedVcfFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{
    type: "csv" | "vcf";
    imported: number;
    errors?: number;
  } | null>(null);

  // CSV Import Mutation
  const importCsvMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("csv", file);
      const res = await fetch("/api/import-csv", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to import CSV");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people/paginated"] });
      setImportResult({ type: "csv", imported: data.imported, errors: data.errors });
      toast({
        title: "CSV Import Successful",
        description: `Imported ${data.imported} contacts into your network.`,
      });
      setSelectedCsvFile(null);
    },
    onError: (err: any) => {
      toast({ title: "Import Failed", description: err.message, variant: "destructive" });
    },
  });

  // VCF Import Mutation
  const importVcfMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("vcf", file);
      const res = await fetch("/api/import-vcf", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to import VCF");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people/paginated"] });
      setImportResult({ type: "vcf", imported: data.imported, errors: data.errors });
      toast({
        title: "VCF Import Successful",
        description: `Imported ${data.imported} contacts from vCard file.`,
      });
      setSelectedVcfFile(null);
    },
    onError: (err: any) => {
      toast({ title: "Import Failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg bg-muted/40 border">
        <div>
          <h3 className="font-semibold text-base">Import Contacts</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Seed your network immediately by importing contacts from Google Contacts or Apple / vCard exports.
          </p>
        </div>
      </div>

      {importResult && (
        <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-emerald-600 font-medium">
            <CheckCircle2 className="h-4 w-4" />
            <span>
              Successfully imported {importResult.imported} contacts from {importResult.type.toUpperCase()}!
            </span>
          </div>
          <Badge variant="outline" className="text-emerald-600 border-emerald-300">
            Added to Network
          </Badge>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* CSV Import */}
        <Card className="border-border flex flex-col justify-between">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-md bg-emerald-500/10 text-emerald-600">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">Google Contacts (CSV)</CardTitle>
                <CardDescription className="text-xs">
                  Export from{" "}
                  <a
                    href="https://contacts.google.com"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline text-primary inline-flex items-center gap-0.5"
                  >
                    contacts.google.com <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-0 text-xs flex-1 flex flex-col justify-between">
            <div className="space-y-2">
              <Label className="text-xs">Select CSV File</Label>
              <Input
                type="file"
                accept=".csv"
                onChange={(e) => setSelectedCsvFile(e.target.files?.[0] || null)}
                className="h-9 text-xs file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-muted"
              />
              <p className="text-[11px] text-muted-foreground">
                Supports standard Google Contacts CSV header format (Name, Email, Phone, Company).
              </p>
            </div>

            <Button
              size="sm"
              disabled={!selectedCsvFile || importCsvMutation.isPending}
              onClick={() => selectedCsvFile && importCsvMutation.mutate(selectedCsvFile)}
              className="w-full gap-1.5 h-8 text-xs mt-3"
            >
              {importCsvMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              Import CSV Contacts
            </Button>
          </CardContent>
        </Card>

        {/* VCF Import */}
        <Card className="border-border flex flex-col justify-between">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-md bg-sky-500/10 text-sky-600">
                <Contact className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">Apple / vCard (.vcf)</CardTitle>
                <CardDescription className="text-xs">
                  Export from Apple Contacts app or iCloud.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-0 text-xs flex-1 flex flex-col justify-between">
            <div className="space-y-2">
              <Label className="text-xs">Select VCF File</Label>
              <Input
                type="file"
                accept=".vcf,text/vcard"
                onChange={(e) => setSelectedVcfFile(e.target.files?.[0] || null)}
                className="h-9 text-xs file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-muted"
              />
              <p className="text-[11px] text-muted-foreground">
                Supports single and multi-card `.vcf` files with photo avatars and phone numbers.
              </p>
            </div>

            <Button
              size="sm"
              disabled={!selectedVcfFile || importVcfMutation.isPending}
              onClick={() => selectedVcfFile && importVcfMutation.mutate(selectedVcfFile)}
              className="w-full gap-1.5 h-8 text-xs mt-3"
            >
              {importVcfMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              Import VCF Contacts
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="p-3.5 rounded-lg border bg-muted/20 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          Don't have a contact export file handy right now? You can skip this step and add people anytime.
        </span>
      </div>
    </div>
  );
}
