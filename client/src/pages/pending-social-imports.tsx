import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Inbox,
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
  FileSpreadsheet
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
  followersCount: number;
  followingCount: number;
  createdAt: string;
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

export default function PendingSocialImportsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"pending" | "imported" | "all">("all");
  const [page, setPage] = useState(1);
  const [previewRecord, setPreviewRecord] = useState<any | null>(null);
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery<PendingImportResponse>({
    queryKey: ["/api/v1/pending-imports", page, statusFilter, search],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/v1/pending-imports?page=${page}&limit=20&status=${statusFilter}&search=${encodeURIComponent(search)}`);
      return res.json();
    },
  });

  const importMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/v1/pending-imports/${id}/import`);
      return res.json();
    },
    onSuccess: (resData) => {
      toast({
        title: "Import Successful",
        description: `Imported followers & following into PRM contact list.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/pending-imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
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
      setPreviewRecord(fullRecord);
    } catch (err: any) {
      toast({
        title: "Error fetching preview",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  const metrics = data?.metrics || { totalPending: 0, totalImported: 0, totalFollowersCaptured: 0 };

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
            Review and ingest social profiles & CSV networks scraped by the Chrome extension.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2 shrink-0">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
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
            <p className="text-xs text-muted-foreground">Parsed network connections</p>
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
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Loading pending imports...
                </TableCell>
              </TableRow>
            ) : !data?.items || data.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No pending social account imports found.
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
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
                            className="text-muted-foreground hover:text-primary shrink-0"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                        <span className="text-xs text-muted-foreground truncate">@{item.accountUsername}</span>
                      </div>
                    </div>
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
                        {item.followersCount} followers
                      </Badge>
                      <Badge variant="outline" className="text-xs font-normal">
                        {item.followingCount} following
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

                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {!item.alreadyAdded && (
                          <DropdownMenuItem
                            onClick={() => importMutation.mutate(item.id)}
                            className="cursor-pointer gap-2"
                          >
                            <Download className="h-4 w-4 text-emerald-600" /> Import to PRM
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => handleFetchPreview(item.id)}
                          className="cursor-pointer gap-2"
                        >
                          <Eye className="h-4 w-4" /> Preview CSVs
                        </DropdownMenuItem>
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

      {/* Preview Dialog */}
      <Dialog open={!!previewRecord} onOpenChange={(open) => !open && setPreviewRecord(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Import Preview: @{previewRecord?.accountUsername}
            </DialogTitle>
            <DialogDescription>
              Details and raw CSV strings captured by Chrome extension.
            </DialogDescription>
          </DialogHeader>

          {previewRecord && (
            <div className="space-y-4 text-sm pt-2">
              <div className="grid grid-cols-2 gap-4 p-3 bg-muted/40 rounded-lg">
                <div>
                  <span className="font-semibold text-xs text-muted-foreground block">Display Name</span>
                  <span>{previewRecord.accountDisplayName || "—"}</span>
                </div>
                <div>
                  <span className="font-semibold text-xs text-muted-foreground block">Website</span>
                  <span>{previewRecord.accountWebsite || "—"}</span>
                </div>
                <div>
                  <span className="font-semibold text-xs text-muted-foreground block">Email</span>
                  <span>{previewRecord.accountEmail || "—"}</span>
                </div>
                <div>
                  <span className="font-semibold text-xs text-muted-foreground block">Phone</span>
                  <span>{previewRecord.accountPhone || "—"}</span>
                </div>
                <div className="col-span-2">
                  <span className="font-semibold text-xs text-muted-foreground block">Bio</span>
                  <p className="text-muted-foreground whitespace-pre-wrap">{previewRecord.accountBio || "No bio specified."}</p>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-1 flex items-center justify-between">
                  <span>Followers CSV ({previewRecord.followersCount} lines)</span>
                </h4>
                <textarea
                  readOnly
                  rows={5}
                  className="w-full font-mono text-xs p-2.5 rounded bg-muted/60 border resize-none focus:outline-none"
                  value={previewRecord.accountFollowers || "No followers CSV payload."}
                />
              </div>

              <div>
                <h4 className="font-semibold mb-1 flex items-center justify-between">
                  <span>Following CSV ({previewRecord.followingCount} lines)</span>
                </h4>
                <textarea
                  readOnly
                  rows={5}
                  className="w-full font-mono text-xs p-2.5 rounded bg-muted/60 border resize-none focus:outline-none"
                  value={previewRecord.accountFollowing || "No following CSV payload."}
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
