import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, HelpCircle, X, Search, Copy, Check, User, AtSign, ArrowRight, Plus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

type FaceItem = {
  face_uuid: string;
  s3_url: string | null;
  personface_uuid: string | null;
  person_name?: string | null;
  created_at?: string | null;
  photo_id?: string | null;
};

type FaceListResponse = {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  faces: FaceItem[];
};

type Person = {
  id: string;
  firstName: string;
  lastName: string;
  imageUrl?: string | null;
  personfaceUuid?: string | null;
};

type SocialAccount = {
  id: string;
  username: string;
  ownerUuid?: string | null;
  currentProfile?: {
    imageUrl?: string | null;
  } | null;
  imageUrl?: string | null;
};

type FaceGroup = {
  id: string; // either personface_uuid or face_uuid
  personfaceUuid: string | null;
  faces: FaceItem[];
  type: "single" | "multi";
  latestTimestamp: string;
};

export default function UnknownFacesPage() {
  const { toast } = useToast();
  const [selectedGroup, setSelectedGroup] = useState<FaceGroup | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 1. Fetch unidentified faces from PRM-Face API proxy
  const { data: facesData, isLoading: isLoadingFaces, isError: isErrorFaces, error: errorFaces } = useQuery<FaceListResponse>({
    queryKey: ["/api/prm-face/face/without-name"],
    queryFn: async () => {
      const res = await fetch("/api/prm-face/face/without-name?page=1&page_size=100");
      if (!res.ok) throw new Error("Failed to load unidentified faces");
      return res.json();
    }
  });

  // 2. Fetch all CRM people (to check for current connections)
  const { data: people = [], isLoading: isLoadingPeople } = useQuery<Person[]>({
    queryKey: ["/api/people"],
  });

  // 3. Search people endpoint (autocomplete query when searchQuery.length >= 3)
  const { data: searchPeopleResults = [], isFetching: isSearchingPeople } = useQuery<{ uuid: string; name: string }[]>({
    queryKey: ["/api/people/search", searchQuery],
    queryFn: async () => {
      if (searchQuery.length < 3) return [];
      const res = await fetch(`/api/people/search?q=${encodeURIComponent(searchQuery)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: searchQuery.length >= 3,
  });

  // 4. Search social accounts endpoint (autocomplete query when searchQuery.length >= 3)
  const { data: searchSocialResults = [], isFetching: isSearchingSocial } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts", searchQuery],
    queryFn: async () => {
      if (searchQuery.length < 3) return [];
      const res = await fetch(`/api/social-accounts?search=${encodeURIComponent(searchQuery)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: searchQuery.length >= 3,
  });

  // 5. Connect Mutation
  const connectMutation = useMutation({
    mutationFn: async (vars: { faceUuid?: string; personfaceUuid?: string | null; personId?: string; socialAccountId?: string }) => {
      const res = await apiRequest("POST", "/api/prm-face/face/connect", vars);
      return res.json() as Promise<{ success: boolean; personId: string; personfaceUuid: string }>;
    },
    onSuccess: () => {
      toast({
        title: "Connected successfully",
        description: "The face group is now linked to the selected account.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/prm-face/face/without-name"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      setSelectedGroup(null);
      setShowSearch(false);
      setSearchQuery("");
    },
    onError: (err: Error) => {
      toast({
        title: "Connection failed",
        description: err.message,
        variant: "destructive",
      });
    }
  });

  // 6. Disassociate Mutation
  const disassociateMutation = useMutation({
    mutationFn: async (faceUuid: string) => {
      const res = await apiRequest("POST", "/api/prm-face/face/disassociate", { faceUuid });
      return res.json() as Promise<{ success: boolean; newGroupUuid: string }>;
    },
    onSuccess: (data, faceUuid) => {
      toast({
        title: "Face disassociated",
        description: "This face has been split off into its own independent identity.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/prm-face/face/without-name"] });

      if (selectedGroup) {
        const remaining = selectedGroup.faces.filter(f => f.face_uuid !== faceUuid);
        if (remaining.length <= 1) {
          // Close modal if group size drops to 1, or update it
          setSelectedGroup(null);
        } else {
          setSelectedGroup({
            ...selectedGroup,
            faces: remaining,
          });
        }
      }
    },
    onError: (err: Error) => {
      toast({
        title: "Disassociation failed",
        description: err.message,
        variant: "destructive",
      });
    }
  });

  // Handle Connect Submission
  const handleConnect = (vars: { personId?: string; socialAccountId?: string }) => {
    if (!selectedGroup) return;
    connectMutation.mutate({
      personfaceUuid: selectedGroup.personfaceUuid,
      faceUuid: selectedGroup.faces[0]?.face_uuid,
      ...vars,
    });
  };

  // Format Timestamps & Dates
  const formatTimestamp = (val?: string | null) => {
    if (!val) return "";
    try {
      return new Date(val).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return val;
    }
  };

  const formatDateOnly = (val?: string | null) => {
    if (!val) return "";
    try {
      return new Date(val).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      });
    } catch {
      return val;
    }
  };

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({ title: "Copied UUID", description: "Successfully copied the ID to clipboard." });
  };

  // Grouping logic for rendering cards
  const facesList = facesData?.faces || [];
  const grouped: Record<string, FaceItem[]> = {};
  const singleFaces: FaceItem[] = [];

  facesList.forEach((face) => {
    if (!face.personface_uuid) {
      singleFaces.push(face);
    } else {
      if (!grouped[face.personface_uuid]) {
        grouped[face.personface_uuid] = [];
      }
      grouped[face.personface_uuid].push(face);
    }
  });

  const groups: FaceGroup[] = [];

  Object.entries(grouped).forEach(([personfaceUuid, groupFaces]) => {
    groupFaces.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    groups.push({
      id: personfaceUuid,
      personfaceUuid,
      faces: groupFaces,
      type: groupFaces.length > 1 ? "multi" : "single",
      latestTimestamp: groupFaces[0].created_at || "",
    });
  });

  singleFaces.forEach((face) => {
    groups.push({
      id: face.face_uuid,
      personfaceUuid: null,
      faces: [face],
      type: "single",
      latestTimestamp: face.created_at || "",
    });
  });

  // Sort groups by latest face timestamp descending
  groups.sort((a, b) => new Date(b.latestTimestamp || 0).getTime() - new Date(a.latestTimestamp || 0).getTime());

  if (isLoadingFaces || isLoadingPeople) {
    return (
      <div className="flex items-center justify-center py-24" data-testid="loading-unknown-faces">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isErrorFaces) {
    return (
      <div className="container max-w-full md:max-w-6xl py-8 px-4 pl-12 mx-auto md:mx-0">
        <div className="flex items-start gap-3 rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm">
          <HelpCircle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
          <span className="text-destructive">{(errorFaces as Error).message}</span>
        </div>
      </div>
    );
  }

  // Check if a group is connected to a person
  const getConnectedEntity = (personfaceUuid: string | null) => {
    if (!personfaceUuid) return null;
    return people.find((p) => p.personfaceUuid === personfaceUuid);
  };

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="container max-w-full md:max-w-6xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
        {/* Page Header */}
        <div className="space-y-2 mb-8">
          <h1 className="text-2xl font-bold flex items-center gap-2 tracking-tight">
            <HelpCircle className="h-6 w-6 text-primary" />
            Unmatched Faces Queue
          </h1>
          <p className="text-muted-foreground text-sm max-w-2xl">
            Identify unrecognized faces extracted by background scraper jobs. Assign them to existing CRM contacts,
            link them to social media profiles, or disassociate grouped faces.
          </p>
        </div>

        {/* Empty state */}
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 text-center border border-dashed rounded-2xl bg-muted/10 max-w-2xl mx-auto">
            <Check className="h-12 w-12 text-emerald-500 mb-4 p-2 bg-emerald-500/10 rounded-full" />
            <h3 className="text-lg font-semibold">All Faces Identified</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-md">
              There are no pending unrecognized faces in the database. Every registered face is currently mapped to a contact.
            </p>
          </div>
        ) : (
          /* Cards Grid */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
            {groups.map((group) => {
              const latestFace = group.faces[0];
              const displayUrl = latestFace.s3_url || "";
              
              return (
                <Card 
                  key={group.id} 
                  className="overflow-hidden border border-border/40 bg-card/40 hover:bg-card/90 hover:border-border transition-all duration-300 rounded-2xl flex flex-col group"
                >
                  <CardContent className="p-3 flex-1 flex flex-col justify-between">
                    {/* Rounded Image with Modal Trigger */}
                    <div 
                      className="relative aspect-square bg-zinc-950 rounded-xl overflow-hidden cursor-pointer border border-border/20 shadow-inner group/img"
                      onClick={() => setSelectedGroup(group)}
                    >
                      {displayUrl ? (
                        <img
                          src={displayUrl}
                          alt="Unidentified face cutout"
                          className="w-full h-full object-cover transition-transform duration-505 group-hover/img:scale-105"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground/30">
                          <User className="h-12 w-12" />
                        </div>
                      )}
                      
                      {/* Multi-Image Badge */}
                      {group.type === "multi" && (
                        <div className="absolute top-2 left-2 bg-zinc-950/80 backdrop-blur-md text-zinc-200 text-[10px] px-2 py-0.5 rounded-full font-semibold border border-zinc-800 shadow-md">
                          {group.faces.length} Photos
                        </div>
                      )}
                    </div>

                    {/* Bottom controls */}
                    <div className="flex items-center justify-between mt-3 px-0.5">
                      <Button
                        size="sm"
                        className="h-7 text-xs font-semibold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground shadow"
                        onClick={() => setSelectedGroup(group)}
                      >
                        Connect
                      </Button>
                      <span className="text-[10px] text-muted-foreground font-medium truncate max-w-[100px]">
                        {formatTimestamp(group.latestTimestamp)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Reworked face modal popup (General display popup) */}
      <Dialog 
        open={!!selectedGroup} 
        onOpenChange={(open) => {
          if (!open) {
            setSelectedGroup(null);
            setShowSearch(false);
            setSearchQuery("");
          }
        }}
      >
        <DialogContent className="max-w-4xl p-0 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 text-white shadow-2xl flex flex-col md:grid md:grid-cols-5 md:max-h-[80vh]">
          {/* Left section: Matched Faces Section (takes 3/5 cols on desktop) */}
          <div className="md:col-span-3 p-6 flex flex-col overflow-hidden bg-zinc-950">
            <div className="mb-4">
              <DialogTitle className="text-lg font-bold text-zinc-100 flex items-center gap-2">
                Face Group Details
              </DialogTitle>
              <DialogDescription className="text-xs text-zinc-400">
                {selectedGroup && selectedGroup.faces.length > 1 
                  ? `Contains ${selectedGroup.faces.length} matched faces grouped under the same identity.`
                  : "Contains a single isolated face cutout."
                }
              </DialogDescription>
            </div>

            {/* Scrollable list/grid of faces */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-4 max-h-[40vh] md:max-h-none">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {selectedGroup?.faces.map((face) => (
                  <div 
                    key={face.face_uuid} 
                    className="relative group rounded-xl overflow-hidden border border-zinc-900 bg-zinc-900/60 aspect-square flex flex-col justify-between"
                  >
                    {/* Face crop */}
                    <div className="flex-1 overflow-hidden relative">
                      <img 
                        src={face.s3_url || ""} 
                        alt="Face crop" 
                        className="w-full h-full object-cover" 
                      />
                      
                      {/* Disassociate Red X Icon */}
                      {selectedGroup.faces.length > 1 && (
                        <Button
                          size="icon"
                          variant="destructive"
                          className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-red-600 hover:bg-red-700 opacity-0 group-hover:opacity-100 transition-opacity duration-200 border border-zinc-950/20 shadow-md"
                          onClick={() => disassociateMutation.mutate(face.face_uuid)}
                          disabled={disassociateMutation.isPending}
                          title="Disassociate face from group"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    
                    {/* Face crop date */}
                    <div className="p-1.5 bg-zinc-900 border-t border-zinc-800 text-center">
                      <span className="text-[10px] text-zinc-400 font-semibold">
                        {formatDateOnly(face.created_at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right section: Data Panel (takes 2/5 cols on desktop) */}
          <div className="md:col-span-2 p-6 flex flex-col justify-between bg-zinc-900/40 border-t md:border-t-0 md:border-l border-zinc-800 overflow-y-auto">
            {selectedGroup && (() => {
              const connectedEntity = getConnectedEntity(selectedGroup.personfaceUuid);
              
              if (connectedEntity) {
                // Connected state display
                const initials = `${connectedEntity.firstName[0] || ""}${connectedEntity.lastName[0] || ""}`;
                return (
                  <div className="space-y-6 flex-1 flex flex-col justify-between">
                    <div className="space-y-4">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Connected Identity</h3>
                      <div className="flex items-center gap-3 bg-zinc-900/60 p-3 rounded-xl border border-zinc-800">
                        <Avatar className="h-10 w-10 border border-zinc-700">
                          {connectedEntity.imageUrl && <AvatarImage src={connectedEntity.imageUrl} />}
                          <AvatarFallback className="bg-zinc-800 text-sm font-semibold text-zinc-200">{initials}</AvatarFallback>
                        </Avatar>
                        <div className="overflow-hidden">
                          <p className="text-sm font-bold text-zinc-100 truncate">
                            {connectedEntity.firstName} {connectedEntity.lastName}
                          </p>
                          <p className="text-[10px] text-zinc-500 font-medium">CRM Contact</p>
                        </div>
                      </div>
                    </div>
                    
                    {/* Raw personface_uuid */}
                    <div className="space-y-2 mt-auto pt-6">
                      <Label className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Group UUID</Label>
                      <div className="flex items-center gap-2 bg-zinc-950 p-2 rounded-lg border border-zinc-800 text-[10px] font-mono text-zinc-400">
                        <span className="truncate flex-1">{selectedGroup.personfaceUuid}</span>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-5 w-5 hover:bg-zinc-800 text-zinc-400"
                          onClick={() => handleCopyId(selectedGroup.personfaceUuid || "")}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              } else {
                // Not-connected state display
                return (
                  <div className="space-y-6 flex-1 flex flex-col justify-between">
                    <div className="space-y-4">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 flex items-center justify-between">
                        <span>Identity Connection</span>
                        <span className="text-[9px] bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 px-2 py-0.5 rounded-full font-semibold">
                          Unassigned
                        </span>
                      </h3>

                      {!showSearch ? (
                        <Button
                          className="w-full text-xs font-semibold rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 flex items-center justify-center gap-2 py-5"
                          onClick={() => setShowSearch(true)}
                        >
                          <ArrowRight className="h-4 w-4" />
                          Connect Account
                        </Button>
                      ) : (
                        <div className="space-y-3">
                          <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
                            <Input
                              placeholder="Search people or social media..."
                              className="pl-9 text-xs rounded-xl bg-zinc-950 border-zinc-800 text-white placeholder-zinc-500 h-9"
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              autoFocus
                            />
                          </div>

                          {/* Autocomplete Selection List */}
                          <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950 max-h-[30vh] overflow-y-auto">
                            {searchQuery.length < 3 ? (
                              <div className="p-4 text-center text-xs text-zinc-500 font-medium">
                                Type 3+ characters to search contacts...
                              </div>
                            ) : (
                              <>
                                {(isSearchingPeople || isSearchingSocial) && (
                                  <div className="p-3 text-center text-xs text-zinc-500 flex items-center justify-center gap-2">
                                    <Loader2 className="h-3 w-3 animate-spin" /> Searching...
                                  </div>
                                )}

                                {!isSearchingPeople && !isSearchingSocial && searchPeopleResults.length === 0 && searchSocialResults.length === 0 && (
                                  <div className="p-4 text-center text-xs text-zinc-500 font-medium">
                                    No accounts or contacts found.
                                  </div>
                                )}

                                {/* People Results */}
                                {searchPeopleResults.map((p) => {
                                  const nameParts = (p.name || "").trim().split(/\s+/);
                                  const initials = nameParts.map(part => part[0] || "").join("").substring(0, 2).toUpperCase();
                                  return (
                                    <button
                                      key={p.uuid}
                                      className="w-full p-2.5 hover:bg-zinc-900 border-b border-zinc-900 text-left flex items-center gap-3 transition-colors group"
                                      onClick={() => handleConnect({ personId: p.uuid })}
                                      disabled={connectMutation.isPending}
                                    >
                                      <Avatar className="h-7 w-7 border border-zinc-800">
                                        <AvatarFallback className="bg-zinc-800 text-[10px] font-bold text-zinc-300">{initials}</AvatarFallback>
                                      </Avatar>
                                      <div className="overflow-hidden flex-1">
                                        <p className="text-xs font-bold text-zinc-200 group-hover:text-white truncate">
                                          {p.name}
                                        </p>
                                        <p className="text-[9px] text-zinc-500 font-medium">CRM Contact</p>
                                      </div>
                                      <Plus className="h-3.5 w-3.5 text-zinc-600 group-hover:text-zinc-300" />
                                    </button>
                                  );
                                })}

                                {/* Social Account Results */}
                                {searchSocialResults.map((sa) => {
                                  const initials = sa.username.substring(0, 2).toUpperCase();
                                  const avatarImg = sa.imageUrl || sa.currentProfile?.imageUrl;
                                  return (
                                    <button
                                      key={sa.id}
                                      className="w-full p-2.5 hover:bg-zinc-900 border-b border-zinc-900 text-left flex items-center gap-3 transition-colors group"
                                      onClick={() => handleConnect({ socialAccountId: sa.id })}
                                      disabled={connectMutation.isPending}
                                    >
                                      <Avatar className="h-7 w-7 border border-zinc-800">
                                        {avatarImg && <AvatarImage src={avatarImg} />}
                                        <AvatarFallback className="bg-zinc-800 text-[10px] font-bold text-zinc-300">{initials}</AvatarFallback>
                                      </Avatar>
                                      <div className="overflow-hidden flex-1">
                                        <p className="text-xs font-bold text-zinc-200 group-hover:text-white truncate">
                                          @{sa.username}
                                        </p>
                                        <p className="text-[9px] text-zinc-500 font-medium flex items-center gap-1">
                                          <AtSign className="h-2 w-2" /> Social Account
                                        </p>
                                      </div>
                                      <Plus className="h-3.5 w-3.5 text-zinc-600 group-hover:text-zinc-300" />
                                    </button>
                                  );
                                })}
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* Raw group UUID */}
                    {selectedGroup.personfaceUuid && (
                      <div className="space-y-2 mt-auto pt-6">
                        <Label className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Group UUID</Label>
                        <div className="flex items-center gap-2 bg-zinc-950 p-2 rounded-lg border border-zinc-800 text-[10px] font-mono text-zinc-400">
                          <span className="truncate flex-1">{selectedGroup.personfaceUuid}</span>
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            className="h-5 w-5 hover:bg-zinc-800 text-zinc-400"
                            onClick={() => handleCopyId(selectedGroup.personfaceUuid || "")}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
