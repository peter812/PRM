import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Inbox,
  User,
  UserCheck,
  Users,
  ExternalLink,
  MoreVertical,
  Download,
  Eye,
  Trash2,
  Search,
  CheckCircle2,
  Clock,
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  RefreshCw,
  FileSpreadsheet,
  Globe,
  Copy,
  Calendar,
  Info
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getInitials } from "@/lib/utils";

interface PendingImportItem {
  id: string;
  timestampAdded: string;
  timestampImported: string | null;
  alreadyAdded: boolean;
  accountUsername: string;
  accountDisplayName: string | null;
  accountBio: string | null;
  accountWebsite: string | null;
  accountEmail: string | null;
  accountPhone: string | null;
  accountLocationArea: string | null;
  accountImageUrl?: string | null;
  accountFollowers?: string | null;
  accountFollowing?: string | null;
  accountFollowersCount?: number | null;
  accountFollowingCount?: number | null;
  hasFollowersCsv?: boolean;
  hasFollowingCsv?: boolean;
  importType: string;
  followersCount: number;
  followingCount: number;
  createdAt: string;
  updatedAt?: string | null;
}

interface PendingImportResponse {
  items: PendingImportItem[];
  total: number;
  page: number;
  totalPages: number;
  metrics: {
    totalPending: number;
    totalImported: number;
    totalFollowersCaptured: number;
  };
}

function formatTimestamp(dateStr: string | null | undefined): { formatted: string; relative: string } {
  if (!dateStr) return { formatted: "—", relative: "" };
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return { formatted: dateStr, relative: "" };
    return {
      formatted: format(d, "PPpp"),
      relative: formatDistanceToNow(d, { addSuffix: true }),
    };
  } catch {
    return { formatted: dateStr, relative: "" };
  }
}

function formatExternalUrl(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export default function PendingSocialImportsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"pending" | "imported" | "all">("all");
  const [page, setPage] = useState(1);
  const [previewRecord, setPreviewRecord] = useState<PendingImportItem | null>(null);
  const [isDeleteAllOpen, setIsDeleteAllOpen] = useState(false);
  const [includeGraphImages, setIncludeGraphImages] = useState(false);
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery<PendingImportResponse>({
    queryKey: ["/api/v1/pending-imports", page, statusFilter, search],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/v1/pending-imports?page=${page}&limit=20&status=${statusFilter}&search=${encodeURIComponent(search)}`);
      return res.json();
    },
  });

  const importMutation = useMutation({
    mutationFn: async ({ id, includeGraphImages }: { id: string; includeGraphImages: boolean }) => {
      const res = await apiRequest("POST", `/api/v1/pending-imports/${id}/import`, { includeGraphImages });
      return res.json();
    },
    onMutate: () => {
      setPreviewRecord(null);
    },
    onSuccess: () => {
      toast({
        title: "Import Task Started",
        description: "Social extraction import queued in the background.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/pending-imports"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Import Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/v1/pending-imports/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Deleted Record",
        description: "Pending import record removed.",
      });
      if (previewRecord) {
        setPreviewRecord(null);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/v1/pending-imports"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Delete Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleFetchPreview = async (id: string) => {
    try {
      const res = await apiRequest("GET", `/api/v1/pending-imports/${id}`);
      const fullRecord = await res.json();
      setIncludeGraphImages(false);
      setPreviewRecord(fullRecord);
    } catch (err: any) {
      toast({
        title: "Error fetching preview",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: `${label} copied to clipboard.`,
    });
  };

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "DELETE",
        `/api/v1/pending-imports?status=${statusFilter}&search=${encodeURIComponent(search)}`,
      );
      return res.json();
    },
    onSuccess: (resData) => {
      toast({
        title: "Records Deleted",
        description: `Removed ${resData.deletedCount} pending import${resData.deletedCount === 1 ? "" : "s"}.`,
      });
      setIsDeleteAllOpen(false);
      setPage(1);
      queryClient.invalidateQueries({ queryKey: ["/api/v1/pending-imports"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Delete Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const metrics = data?.metrics || { totalPending: 0, totalImported: 0, totalFollowersCaptured: 0 };
  const total = data?.total ?? 0;

  // The button deletes whatever the current filters match, so say which that is.
  const deleteAllScope =
    statusFilter === "pending" ? "pending" : statusFilter === "imported" ? "imported" : "";
  const deleteAllDescription = [
    `This permanently deletes ${total} ${deleteAllScope} record${total === 1 ? "" : "s"}`.replace("  ", " "),
    search.trim() ? ` matching "${search.trim()}"` : "",
    ". Social accounts and people already ingested into PRM are not affected.",
  ].join("");

  const addedTimestamp = previewRecord ? formatTimestamp(previewRecord.timestampAdded) : null;
  const importedTimestamp = previewRecord ? formatTimestamp(previewRecord.timestampImported) : null;
  const createdTimestamp = previewRecord ? formatTimestamp(previewRecord.createdAt) : null;
  const hasCsvData = Boolean(
    previewRecord &&
    ((previewRecord.accountFollowers && previewRecord.accountFollowers.trim()) ||
     (previewRecord.accountFollowing && previewRecord.accountFollowing.trim()))
  );

  return (
    <div className="flex-1 space-y-6 p-6 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Link href="/social-accounts" className="hover:underline flex items-center gap-1">
              <ArrowLeft className="h-3.5 w-3.5" /> Social Accounts
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Pending Social Imports</h1>
          <p className="text-muted-foreground text-sm">
            Review and ingest social profiles & CSV networks scraped by the Chrome extension. Click any row to view full details.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setIsDeleteAllOpen(true)}
            disabled={total === 0 || deleteAllMutation.isPending}
            className="gap-2"
            data-testid="button-delete-all"
          >
            <Trash2 className="h-4 w-4" /> Delete All{total > 0 ? ` (${total})` : ""}
          </Button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Pending Imports</CardTitle>
            <Inbox className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.totalPending}</div>
            <p className="text-xs text-muted-foreground">Awaiting review or ingestion</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Imported Profiles</CardTitle>
            <UserCheck className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.totalImported}</div>
            <p className="text-xs text-muted-foreground">Ingested into main contact list</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Followers Captured</CardTitle>
            <Users className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.totalFollowersCaptured.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Parsed network connections (latest pull per account)</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search username or name..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            variant={statusFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => { setStatusFilter("all"); setPage(1); }}
          >
            All
          </Button>
          <Button
            variant={statusFilter === "pending" ? "default" : "outline"}
            size="sm"
            onClick={() => { setStatusFilter("pending"); setPage(1); }}
          >
            Pending
          </Button>
          <Button
            variant={statusFilter === "imported" ? "default" : "outline"}
            size="sm"
            onClick={() => { setStatusFilter("imported"); setPage(1); }}
          >
            Imported
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card className="shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account Profile</TableHead>
              <TableHead>Extraction</TableHead>
              <TableHead>Bio Snippet</TableHead>
              <TableHead>Contact / Location</TableHead>
              <TableHead className="text-center">Followers / Following</TableHead>
              <TableHead>Time Added</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Loading pending imports...
                </TableCell>
              </TableRow>
            ) : !data?.items || data.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No pending social account imports found.
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((item) => (
                <TableRow
                  key={item.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => handleFetchPreview(item.id)}
                  data-testid={`row-pending-import-${item.id}`}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        {item.accountImageUrl && <AvatarImage src={item.accountImageUrl} alt={item.accountUsername} />}
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                          {getInitials(item.accountDisplayName || item.accountUsername)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5 font-medium text-sm">
                          <span className="truncate">{item.accountDisplayName || item.accountUsername}</span>
                          <a
                            href={`https://instagram.com/${item.accountUsername}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-muted-foreground hover:text-primary shrink-0"
                            title="Open Instagram Profile"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                        <span className="text-xs text-muted-foreground truncate">@{item.accountUsername}</span>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    {item.importType === "account" ? (
                      <Badge
                        variant="outline"
                        className="gap-1 text-xs font-normal bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30"
                        data-testid={`badge-import-type-${item.id}`}
                      >
                        <User className="h-3 w-3" /> Account only
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="gap-1 text-xs font-normal bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30"
                        data-testid={`badge-import-type-${item.id}`}
                      >
                        <Users className="h-3 w-3" /> Account + followers
                      </Badge>
                    )}
                  </TableCell>

                  <TableCell className="max-w-[200px]">
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {item.accountBio || "No bio"}
                    </p>
                  </TableCell>

                  <TableCell>
                    <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                      {item.accountEmail && (
                        <div className="flex items-center gap-1">
                          <Mail className="h-3 w-3 text-muted-foreground" /> {item.accountEmail}
                        </div>
                      )}
                      {item.accountPhone && (
                        <div className="flex items-center gap-1">
                          <Phone className="h-3 w-3 text-muted-foreground" /> {item.accountPhone}
                        </div>
                      )}
                      {item.accountLocationArea && (
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3 w-3 text-muted-foreground" /> {item.accountLocationArea}
                        </div>
                      )}
                      {!item.accountEmail && !item.accountPhone && !item.accountLocationArea && (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </div>
                  </TableCell>

                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-2">
                      <Badge variant="outline" className="text-xs font-normal">
                        {item.followersCount.toLocaleString()} followers
                      </Badge>
                      <Badge variant="outline" className="text-xs font-normal">
                        {item.followingCount.toLocaleString()} following
                      </Badge>
                    </div>
                  </TableCell>

                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(item.timestampAdded).toLocaleDateString()} {new Date(item.timestampAdded).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </TableCell>

                  <TableCell>
                    {item.alreadyAdded ? (
                      <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 gap-1 border-0">
                        <CheckCircle2 className="h-3 w-3" /> Already Added
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 gap-1 border-amber-500/30">
                        <Clock className="h-3 w-3" /> Pending
                      </Badge>
                    )}
                  </TableCell>

                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleFetchPreview(item.id)}
                          className="cursor-pointer gap-2"
                        >
                          <Eye className="h-4 w-4" /> View Details
                        </DropdownMenuItem>
                        {!item.alreadyAdded && (
                          <DropdownMenuItem
                            onClick={() => importMutation.mutate({ id: item.id, includeGraphImages: false })}
                            className="cursor-pointer gap-2"
                          >
                            <Download className="h-4 w-4 text-emerald-600" /> Import to PRM
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => deleteMutation.mutate(item.id)}
                          className="cursor-pointer text-destructive focus:text-destructive gap-2"
                        >
                          <Trash2 className="h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Detailed Import Preview Modal */}
      <Dialog open={!!previewRecord} onOpenChange={(open) => !open && setPreviewRecord(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {previewRecord && (
            <div className="space-y-6">
              {/* Modal Header */}
              <DialogHeader className="space-y-3 pb-2 border-b">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-14 w-14 border shadow-sm">
                      {previewRecord.accountImageUrl && (
                        <AvatarImage src={previewRecord.accountImageUrl} alt={previewRecord.accountUsername} />
                      )}
                      <AvatarFallback className="bg-primary/10 text-primary text-lg font-bold">
                        {getInitials(previewRecord.accountDisplayName || previewRecord.accountUsername)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <DialogTitle className="text-xl font-bold flex items-center gap-2">
                        {previewRecord.accountDisplayName || previewRecord.accountUsername}
                      </DialogTitle>
                      <DialogDescription className="text-sm font-medium text-muted-foreground flex items-center gap-2 mt-0.5">
                        <span>@{previewRecord.accountUsername}</span>
                        <span>•</span>
                        <a
                          href={`https://instagram.com/${previewRecord.accountUsername}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline inline-flex items-center gap-1 font-normal"
                        >
                          Instagram <ExternalLink className="h-3 w-3" />
                        </a>
                      </DialogDescription>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:self-start">
                    {previewRecord.alreadyAdded ? (
                      <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 gap-1 border-0 py-1">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Ingested to PRM
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 gap-1 border-amber-500/30 py-1">
                        <Clock className="h-3.5 w-3.5" /> Pending Review
                      </Badge>
                    )}

                    {previewRecord.importType === "account" ? (
                      <Badge variant="outline" className="gap-1 bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30 py-1">
                        <User className="h-3.5 w-3.5" /> Account Only
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30 py-1">
                        <Users className="h-3.5 w-3.5" /> Account + Followers
                      </Badge>
                    )}
                  </div>
                </div>
              </DialogHeader>

              {/* Grid: Web Links & Contact Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Contact & Web Information */}
                <div className="p-4 bg-muted/30 border rounded-lg space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5 text-primary" /> Contact & Web Details
                  </h4>
                  <div className="space-y-2.5 text-sm">
                    {/* Website */}
                    <div className="flex items-start gap-2">
                      <Globe className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-muted-foreground block">Website</span>
                        {previewRecord.accountWebsite ? (
                          <a
                            href={formatExternalUrl(previewRecord.accountWebsite)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-1 truncate max-w-full font-medium"
                          >
                            {previewRecord.accountWebsite}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground text-xs">No website provided</span>
                        )}
                      </div>
                    </div>

                    {/* Email */}
                    <div className="flex items-start gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-muted-foreground block">Email</span>
                        {previewRecord.accountEmail ? (
                          <div className="flex items-center gap-2">
                            <a
                              href={`mailto:${previewRecord.accountEmail}`}
                              className="text-primary hover:underline truncate font-medium"
                            >
                              {previewRecord.accountEmail}
                            </a>
                            <button
                              onClick={() => handleCopy(previewRecord.accountEmail!, "Email")}
                              className="text-muted-foreground hover:text-foreground p-0.5"
                              title="Copy email"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">No email provided</span>
                        )}
                      </div>
                    </div>

                    {/* Phone */}
                    <div className="flex items-start gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-muted-foreground block">Phone</span>
                        {previewRecord.accountPhone ? (
                          <div className="flex items-center gap-2">
                            <a
                              href={`tel:${previewRecord.accountPhone}`}
                              className="text-primary hover:underline font-medium"
                            >
                              {previewRecord.accountPhone}
                            </a>
                            <button
                              onClick={() => handleCopy(previewRecord.accountPhone!, "Phone")}
                              className="text-muted-foreground hover:text-foreground p-0.5"
                              title="Copy phone"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">No phone provided</span>
                        )}
                      </div>
                    </div>

                    {/* Location */}
                    <div className="flex items-start gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-muted-foreground block">Location / Area</span>
                        <span className="font-medium">{previewRecord.accountLocationArea || "—"}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Timestamps & Audit Info */}
                <div className="p-4 bg-muted/30 border rounded-lg space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-primary" /> Timestamps & Audit
                  </h4>
                  <div className="space-y-2.5 text-sm">
                    {/* Timestamp Added */}
                    <div>
                      <span className="text-xs text-muted-foreground block">Added / Scraped</span>
                      <div className="font-medium text-xs">
                        {addedTimestamp?.formatted}
                        {addedTimestamp?.relative && (
                          <span className="text-muted-foreground ml-1">({addedTimestamp.relative})</span>
                        )}
                      </div>
                    </div>

                    {/* Timestamp Imported */}
                    <div>
                      <span className="text-xs text-muted-foreground block">Ingested into PRM</span>
                      <div className="font-medium text-xs">
                        {previewRecord.timestampImported ? (
                          <>
                            {importedTimestamp?.formatted}
                            {importedTimestamp?.relative && (
                              <span className="text-muted-foreground ml-1">({importedTimestamp.relative})</span>
                            )}
                          </>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">Not yet ingested</span>
                        )}
                      </div>
                    </div>

                    {/* Created At */}
                    <div>
                      <span className="text-xs text-muted-foreground block">Record Created</span>
                      <span className="font-medium text-xs">{createdTimestamp?.formatted || "—"}</span>
                    </div>

                    {/* Record ID */}
                    <div>
                      <span className="text-xs text-muted-foreground block">Import Record ID</span>
                      <div className="flex items-center gap-1.5">
                        <code className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground truncate">
                          {previewRecord.id}
                        </code>
                        <button
                          onClick={() => handleCopy(previewRecord.id, "Record ID")}
                          className="text-muted-foreground hover:text-foreground p-0.5"
                          title="Copy ID"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bio Section */}
              <div className="p-4 bg-muted/30 border rounded-lg space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
                  Bio
                </span>
                <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                  {previewRecord.accountBio || <span className="text-muted-foreground italic">No bio available.</span>}
                </p>
              </div>

              {/* Network Stats Cards */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-muted/20 border rounded-lg flex items-center justify-between">
                  <div>
                    <span className="text-xs text-muted-foreground block">Followers Count</span>
                    <span className="text-lg font-bold">{previewRecord.followersCount.toLocaleString()}</span>
                  </div>
                  <Badge variant="outline" className="text-xs font-normal">
                    {previewRecord.accountFollowers ? "CSV Attached" : "Profile Count"}
                  </Badge>
                </div>
                <div className="p-3 bg-muted/20 border rounded-lg flex items-center justify-between">
                  <div>
                    <span className="text-xs text-muted-foreground block">Following Count</span>
                    <span className="text-lg font-bold">{previewRecord.followingCount.toLocaleString()}</span>
                  </div>
                  <Badge variant="outline" className="text-xs font-normal">
                    {previewRecord.accountFollowing ? "CSV Attached" : "Profile Count"}
                  </Badge>
                </div>
              </div>

              {/* Raw CSV Inspector (if CSV data exists) */}
              {hasCsvData && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <FileSpreadsheet className="h-3.5 w-3.5 text-primary" /> Captured Network CSVs
                    </h4>
                  </div>
                  <Tabs defaultValue="followers" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="followers" className="gap-2">
                        <span>Followers CSV</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                          {previewRecord.followersCount}
                        </Badge>
                      </TabsTrigger>
                      <TabsTrigger value="following" className="gap-2">
                        <span>Following CSV</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                          {previewRecord.followingCount}
                        </Badge>
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="followers" className="space-y-2 pt-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Raw CSV payload</span>
                        {previewRecord.accountFollowers && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopy(previewRecord.accountFollowers!, "Followers CSV")}
                            className="h-7 gap-1 text-xs"
                          >
                            <Copy className="h-3 w-3" /> Copy CSV
                          </Button>
                        )}
                      </div>
                      <textarea
                        readOnly
                        rows={6}
                        className="w-full font-mono text-xs p-2.5 rounded bg-muted/60 border resize-none focus:outline-none"
                        value={previewRecord.accountFollowers || "No followers CSV payload."}
                      />
                    </TabsContent>
                    <TabsContent value="following" className="space-y-2 pt-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Raw CSV payload</span>
                        {previewRecord.accountFollowing && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopy(previewRecord.accountFollowing!, "Following CSV")}
                            className="h-7 gap-1 text-xs"
                          >
                            <Copy className="h-3 w-3" /> Copy CSV
                          </Button>
                        )}
                      </div>
                      <textarea
                        readOnly
                        rows={6}
                        className="w-full font-mono text-xs p-2.5 rounded bg-muted/60 border resize-none focus:outline-none"
                        value={previewRecord.accountFollowing || "No following CSV payload."}
                      />
                    </TabsContent>
                  </Tabs>
                </div>
              )}

              {/* Modal Actions Footer */}
              <div className="flex flex-col gap-4 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className="gap-1.5"
                  >
                    <a
                      href={`https://instagram.com/${previewRecord.accountUsername}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-4 w-4" /> Open on Instagram
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMutation.mutate(previewRecord.id)}
                    disabled={deleteMutation.isPending}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
                  >
                    <Trash2 className="h-4 w-4" /> Delete Record
                  </Button>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  {(previewRecord.hasFollowersCsv || previewRecord.hasFollowingCsv) && !previewRecord.alreadyAdded && (
                    <label className="flex items-start gap-2 cursor-pointer max-w-xs text-left">
                      <Checkbox
                        checked={includeGraphImages}
                        onCheckedChange={(checked) => setIncludeGraphImages(!!checked)}
                        className="mt-0.5"
                        data-testid="checkbox-include-graph-images"
                      />
                      <span className="text-xs text-muted-foreground leading-tight">
                        Fetch follower & following avatars
                      </span>
                    </label>
                  )}

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPreviewRecord(null)}
                    >
                      Close
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => importMutation.mutate({ id: previewRecord.id, includeGraphImages })}
                      disabled={importMutation.isPending || previewRecord.alreadyAdded}
                      className="gap-1.5 shrink-0"
                      data-testid="button-import-from-preview"
                    >
                      <Download className="h-4 w-4" />
                      {previewRecord.alreadyAdded ? "Already Ingested" : "Import into PRM"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete All Confirmation Dialog */}
      <AlertDialog open={isDeleteAllOpen} onOpenChange={setIsDeleteAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all pending imports?</AlertDialogTitle>
            <AlertDialogDescription>{deleteAllDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteAllMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                deleteAllMutation.mutate();
              }}
              disabled={deleteAllMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-all"
            >
              {deleteAllMutation.isPending ? "Deleting..." : `Delete ${total}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
