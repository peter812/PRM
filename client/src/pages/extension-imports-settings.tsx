import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Download,
  Trash2,
  Search,
  CheckCircle2,
  Clock,
  Chrome,
  FileSpreadsheet,
  CheckSquare,
  Square,
  RefreshCw,
  Calendar,
  Eye,
  Globe,
  Mail,
  Phone,
  MapPin,
  ExternalLink,
  User,
  Layers
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface ExtensionImportItem {
  id: string;
  timestampAdded: string;
  timestampImported: string | null;
  alreadyAdded: boolean;
  accountUsername: string;
  accountDisplayName: string | null;
  accountBio?: string | null;
  accountWebsite?: string | null;
  accountEmail?: string | null;
  accountPhone?: string | null;
  accountLocationArea?: string | null;
  followersCount: number;
  followingCount: number;
  // A count may come from the profile's reported totals rather than a scraped
  // graph, so it does not imply an exportable CSV. Gate exports on these.
  hasFollowersCsv?: boolean;
  hasFollowingCsv?: boolean;
  importType?: string;
}

export default function ExtensionImportsSettingsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"pending" | "imported" | "all">("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewItem, setPreviewItem] = useState<ExtensionImportItem | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery<{ items: ExtensionImportItem[]; total: number; page: number; totalPages: number }>({
    queryKey: ["/api/v1/pending-imports", page, statusFilter, search],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/v1/pending-imports?page=${page}&limit=50&status=${statusFilter}&search=${encodeURIComponent(search)}`);
      return res.json();
    },
    // The global default is staleTime: Infinity with no refetch on mount or on
    // window focus, which is wrong for this page: rows arrive out-of-band from
    // the Chrome extension, so a cached result means a fresh extraction never
    // appears until a hard reload. Always revalidate on mount and on focus.
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const filteredItems = (data?.items || []).filter(item => {
    if (!startDate && !endDate) return true;
    const addedTime = new Date(item.timestampAdded).getTime();
    if (startDate && addedTime < new Date(startDate).getTime()) return false;
    if (endDate && addedTime > new Date(endDate).getTime() + 86400000) return false;
    return true;
  });

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(filteredItems.map(i => i.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleOpenPreview = async (item: ExtensionImportItem) => {
    try {
      setIsPreviewLoading(true);
      const res = await apiRequest("GET", `/api/v1/pending-imports/${item.id}`);
      const full = await res.json();
      setPreviewItem(full);
    } catch {
      setPreviewItem(item);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const singleImportMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/v1/pending-imports/${id}/import`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Imported Successfully", description: "Record ingested into PRM." });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/pending-imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      if (previewItem) {
        setPreviewItem(prev => prev ? { ...prev, alreadyAdded: true, timestampImported: new Date().toISOString() } : null);
      }
    },
    onError: (err: Error) => {
      toast({ title: "Import Failed", description: err.message, variant: "destructive" });
    },
  });

  const singleDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/v1/pending-imports/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Record Deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/pending-imports"] });
      if (previewItem) setPreviewItem(null);
    },
  });

  const bulkImportMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/v1/pending-imports/bulk-import", { ids });
      return res.json();
    },
    onSuccess: (resData) => {
      toast({ title: "Bulk Import Finished", description: `Ingested ${resData.count} records into PRM.` });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/v1/pending-imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/v1/pending-imports/bulk-delete", { ids });
      return res.json();
    },
    onSuccess: (resData) => {
      toast({ title: "Bulk Delete Complete", description: `Removed ${resData.deletedCount} records.` });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/v1/pending-imports"] });
    },
  });

  const handleDownloadCsv = async (id: string, type: "followers" | "following", username: string) => {
    try {
      const res = await apiRequest("GET", `/api/v1/pending-imports/${id}`);
      const fullRecord = await res.json();
      const content = type === "followers" ? fullRecord.accountFollowers : fullRecord.accountFollowing;

      if (!content || !content.trim()) {
        toast({ title: "No Data", description: `No ${type} CSV captured for this account.` });
        return;
      }

      const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `${username}_${type}_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      toast({ title: "Download Error", description: err.message, variant: "destructive" });
    }
  };

  const isAllSelected = filteredItems.length > 0 && selectedIds.size === filteredItems.length;

  return (
    <div className="container max-w-full md:max-w-6xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Chrome className="h-5 w-5 text-primary" /> Extension Imports
          </h2>
          <p className="text-muted-foreground text-sm">
            Searchable historical grid of all Chrome extension scraped payloads, CSV downloads, and bulk actions.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2 shrink-0">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {/* Filter Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search username..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={statusFilter} onValueChange={(val: any) => setStatusFilter(val)}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="imported">Imported</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1.5">
          <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            type="date"
            placeholder="Start date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="text-xs"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            type="date"
            placeholder="End date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="text-xs"
          />
        </div>
      </div>

      {/* Bulk Action Toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between bg-primary/10 border border-primary/20 p-3 rounded-lg text-sm">
          <span className="font-semibold text-primary">
            {selectedIds.size} record{selectedIds.size > 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => bulkImportMutation.mutate(Array.from(selectedIds))}
              disabled={bulkImportMutation.isPending}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Download className="h-4 w-4" /> Import Selected
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}
              disabled={bulkDeleteMutation.isPending}
              className="gap-1.5"
            >
              <Trash2 className="h-4 w-4" /> Delete Selected
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <Card className="shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={isAllSelected}
                  onCheckedChange={(checked) => handleSelectAll(!!checked)}
                />
              </TableHead>
              <TableHead>UUID</TableHead>
              <TableHead>Username & Display Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Added Date</TableHead>
              <TableHead>Imported Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>CSVs</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  Loading extension imports...
                </TableCell>
              </TableRow>
            ) : filteredItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No extension import records match filters.
                </TableCell>
              </TableRow>
            ) : (
              filteredItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(item.id)}
                      onCheckedChange={() => handleToggleSelect(item.id)}
                    />
                  </TableCell>

                  <TableCell className="font-mono text-xs text-muted-foreground truncate max-w-[100px]">
                    {item.id}
                  </TableCell>

                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-sm">@{item.accountUsername}</span>
                      {item.accountDisplayName && (
                        <span className="text-xs text-muted-foreground">{item.accountDisplayName}</span>
                      )}
                    </div>
                  </TableCell>

                  <TableCell>
                    <Badge variant="outline" className="text-xs font-normal">
                      {item.importType === "account" ? "Profile" : "Full Graph"}
                    </Badge>
                  </TableCell>

                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(item.timestampAdded).toLocaleDateString()}
                  </TableCell>

                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {item.timestampImported ? new Date(item.timestampImported).toLocaleDateString() : "—"}
                  </TableCell>

                  <TableCell>
                    {item.alreadyAdded ? (
                      <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 gap-1 border-0">
                        <CheckCircle2 className="h-3 w-3" /> Imported
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 gap-1 border-amber-500/30">
                        <Clock className="h-3 w-3" /> Pending
                      </Badge>
                    )}
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDownloadCsv(item.id, "followers", item.accountUsername)}
                        className="h-7 px-2 text-xs gap-1"
                        title="Download Followers CSV"
                        disabled={!item.hasFollowersCsv}
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5 text-blue-500" /> Followers ({item.followersCount})
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDownloadCsv(item.id, "following", item.accountUsername)}
                        className="h-7 px-2 text-xs gap-1"
                        title="Download Following CSV"
                        disabled={!item.hasFollowingCsv}
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5 text-purple-500" /> Following ({item.followingCount})
                      </Button>
                    </div>
                  </TableCell>

                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenPreview(item)}
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title="View scraped details"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>

                      {!item.alreadyAdded && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => singleImportMutation.mutate(item.id)}
                          disabled={singleImportMutation.isPending}
                          className="h-7 text-xs gap-1"
                        >
                          <Download className="h-3.5 w-3.5 text-emerald-600" /> Import
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => singleDeleteMutation.mutate(item.id)}
                        disabled={singleDeleteMutation.isPending}
                        className="h-7 w-7 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Scraped Record Preview Dialog */}
      <Dialog open={!!previewItem} onOpenChange={(open) => !open && setPreviewItem(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Chrome className="h-5 w-5 text-primary" />
              Scraped Import Payload Details
            </DialogTitle>
            <DialogDescription>
              Details captured by the Chrome extension for @{previewItem?.accountUsername}.
            </DialogDescription>
          </DialogHeader>

          {previewItem && (
            <div className="space-y-4 py-2 text-sm">
              <div className="flex items-center justify-between border-b pb-3">
                <div>
                  <h3 className="text-base font-semibold">@{previewItem.accountUsername}</h3>
                  {previewItem.accountDisplayName && (
                    <p className="text-muted-foreground">{previewItem.accountDisplayName}</p>
                  )}
                </div>
                <div>
                  {previewItem.alreadyAdded ? (
                    <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Ingested in PRM
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 gap-1 border-amber-500/30">
                      <Clock className="h-3 w-3" /> Pending Review
                    </Badge>
                  )}
                </div>
              </div>

              {previewItem.accountBio && (
                <div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Bio</span>
                  <p className="mt-1 bg-muted/40 p-2.5 rounded text-xs whitespace-pre-wrap">{previewItem.accountBio}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 text-xs">
                {previewItem.accountWebsite && (
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                    <a
                      href={previewItem.accountWebsite.startsWith("http") ? previewItem.accountWebsite : `https://${previewItem.accountWebsite}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline truncate"
                    >
                      {previewItem.accountWebsite}
                    </a>
                  </div>
                )}

                {previewItem.accountEmail && (
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="truncate">{previewItem.accountEmail}</span>
                  </div>
                )}

                {previewItem.accountPhone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span>{previewItem.accountPhone}</span>
                  </div>
                )}

                {previewItem.accountLocationArea && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="truncate">{previewItem.accountLocationArea}</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                <div className="bg-muted/30 p-2 rounded">
                  <span className="text-xs text-muted-foreground">Followers</span>
                  <p className="font-semibold text-base">{previewItem.followersCount}</p>
                </div>
                <div className="bg-muted/30 p-2 rounded">
                  <span className="text-xs text-muted-foreground">Following</span>
                  <p className="font-semibold text-base">{previewItem.followingCount}</p>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                <span>Scraped: {new Date(previewItem.timestampAdded).toLocaleString()}</span>
                {previewItem.timestampImported && (
                  <span>Imported: {new Date(previewItem.timestampImported).toLocaleString()}</span>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
            <div className="flex items-center gap-2">
              {previewItem && previewItem.hasFollowersCsv && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownloadCsv(previewItem.id, "followers", previewItem.accountUsername)}
                  className="gap-1.5 text-xs"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-blue-500" /> Followers CSV
                </Button>
              )}
              {previewItem && previewItem.hasFollowingCsv && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownloadCsv(previewItem.id, "following", previewItem.accountUsername)}
                  className="gap-1.5 text-xs"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-purple-500" /> Following CSV
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {previewItem && !previewItem.alreadyAdded && (
                <Button
                  size="sm"
                  onClick={() => singleImportMutation.mutate(previewItem.id)}
                  disabled={singleImportMutation.isPending}
                  className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Download className="h-4 w-4" /> Import into PRM
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setPreviewItem(null)}>
                Close
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
