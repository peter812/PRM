import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Heart,
  MessageSquare,
  AtSign,
  Plus,
  Sparkles,
  Trash2,
  Check,
  Loader2,
  Info,
} from "lucide-react";
import type { RelationshipType, InteractionType, SocialAccountType } from "@shared/schema";

const COLOR_SWATCHES = [
  "#e11d48", // Rose / Red
  "#db2777", // Pink
  "#7c3aed", // Purple
  "#4f46e5", // Indigo
  "#0284c7", // Sky Blue
  "#059669", // Emerald Green
  "#16a34a", // Green
  "#d97706", // Amber
  "#ea580c", // Orange
  "#475569", // Slate
  "#0a66c2", // LinkedIn Blue
  "#e1306c", // Instagram Pink
];

export function StageDataTypes() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Queries
  const { data: relationshipTypes = [], isLoading: isLoadingRel } = useQuery<RelationshipType[]>({
    queryKey: ["/api/relationship-types"],
  });

  const { data: interactionTypes = [], isLoading: isLoadingInt } = useQuery<InteractionType[]>({
    queryKey: ["/api/interaction-types"],
  });

  const { data: socialAccountTypes = [], isLoading: isLoadingSocial } = useQuery<SocialAccountType[]>({
    queryKey: ["/api/social-account-types"],
  });

  // Inline Add Form State - Relationship
  const [relName, setRelName] = useState("");
  const [relColor, setRelColor] = useState("#0284c7");
  const [relValue, setRelValue] = useState(50);
  const [relNotes, setRelNotes] = useState("");

  // Inline Add Form State - Interaction
  const [intName, setIntName] = useState("");
  const [intColor, setIntColor] = useState("#059669");
  const [intValue, setIntValue] = useState(50);
  const [intDesc, setIntDesc] = useState("");

  // Inline Add Form State - Social Account
  const [socialName, setSocialName] = useState("");
  const [socialColor, setSocialColor] = useState("#e1306c");

  // Mutations
  const addRelationshipMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/relationship-types", {
        name: relName.trim(),
        color: relColor,
        value: relValue,
        notes: relNotes.trim() || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/relationship-types"] });
      setRelName("");
      setRelNotes("");
      toast({ title: `Added relationship type: ${relName}` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to add type", description: err.message, variant: "destructive" });
    },
  });

  const deleteRelationshipMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/relationship-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/relationship-types"] });
      toast({ title: "Relationship type deleted" });
    },
  });

  const addInteractionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/interaction-types", {
        name: intName.trim(),
        color: intColor,
        value: intValue,
        description: intDesc.trim() || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/interaction-types"] });
      setIntName("");
      setIntDesc("");
      toast({ title: `Added interaction type: ${intName}` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to add type", description: err.message, variant: "destructive" });
    },
  });

  const deleteInteractionMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/interaction-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/interaction-types"] });
      toast({ title: "Interaction type deleted" });
    },
  });

  const addSocialMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/social-account-types", {
        name: socialName.trim(),
        color: socialColor,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-account-types"] });
      setSocialName("");
      toast({ title: `Added social account type: ${socialName}` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to add type", description: err.message, variant: "destructive" });
    },
  });

  const deleteSocialMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/social-account-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-account-types"] });
      toast({ title: "Social account type deleted" });
    },
  });

  const seedAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/setup/seed-data-types");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/relationship-types"] });
      queryClient.invalidateQueries({ queryKey: ["/api/interaction-types"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-account-types"] });
      toast({
        title: "Preset Starter Pack Applied",
        description: `Added ${data.created.relationships} relationships, ${data.created.interactions} interactions, ${data.created.socialAccounts} social platforms.`,
      });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg bg-muted/40 border">
        <div>
          <h3 className="font-semibold text-base">Data Types & Graph Schema</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Define the connection strengths, interaction kinds, and social media platforms for your PRM.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => seedAllMutation.mutate()}
          disabled={seedAllMutation.isPending}
          className="gap-2 shrink-0 self-start sm:self-auto"
        >
          {seedAllMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          )}
          Add Recommended Presets
        </Button>
      </div>

      <Tabs defaultValue="relationships" className="w-full">
        <TabsList className="grid grid-cols-3 w-full max-w-md mb-4">
          <TabsTrigger value="relationships" className="flex items-center gap-1.5 text-xs">
            <Heart className="h-3.5 w-3.5 text-rose-500" />
            <span>Relationships</span>
            <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 h-4">
              {relationshipTypes.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="interactions" className="flex items-center gap-1.5 text-xs">
            <MessageSquare className="h-3.5 w-3.5 text-sky-500" />
            <span>Interactions</span>
            <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 h-4">
              {interactionTypes.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="socials" className="flex items-center gap-1.5 text-xs">
            <AtSign className="h-3.5 w-3.5 text-purple-500" />
            <span>Socials</span>
            <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 h-4">
              {socialAccountTypes.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: RELATIONSHIPS */}
        <TabsContent value="relationships" className="space-y-5">
          {/* Current Types */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Current Relationship Types
              </Label>
              <span className="text-xs text-muted-foreground">{relationshipTypes.length} active</span>
            </div>

            {isLoadingRel ? (
              <div className="py-4 flex justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading types...
              </div>
            ) : relationshipTypes.length === 0 ? (
              <div className="p-4 rounded-lg border border-dashed text-center space-y-2">
                <p className="text-xs text-muted-foreground">No relationship types created yet.</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => seedAllMutation.mutate()}
                  disabled={seedAllMutation.isPending}
                >
                  <Sparkles className="h-3 w-3 text-amber-500" /> Populate standard starter pack
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 p-3 rounded-lg border bg-muted/20">
                {relationshipTypes.map((type) => (
                  <div
                    key={type.id}
                    className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border bg-background hover-elevate transition-all group"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0 shadow-sm"
                      style={{ backgroundColor: type.color }}
                    />
                    <span>{type.name}</span>
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.2 rounded">
                      wt {type.value}
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteRelationshipMutation.mutate(type.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity ml-0.5"
                      title="Delete type"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Want to add another one? */}
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <Plus className="h-4 w-4 text-primary" /> Want to add another one?
              </CardTitle>
              <CardDescription className="text-xs">
                Add a custom relationship type with color and connection strength weight.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="rel-name" className="text-xs">Type Name *</Label>
                  <Input
                    id="rel-name"
                    placeholder="e.g. Mentor, Gym Buddy, Cousin"
                    value={relName}
                    onChange={(e) => setRelName(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <Label className="text-xs">Connection Weight (1–255)</Label>
                    <span className="text-xs font-mono font-medium">{relValue}</span>
                  </div>
                  <Slider
                    value={[relValue]}
                    min={1}
                    max={255}
                    step={1}
                    onValueChange={(val) => setRelValue(val[0])}
                    className="py-1"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Color Badge</Label>
                <div className="flex items-center gap-2 flex-wrap">
                  {COLOR_SWATCHES.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setRelColor(hex)}
                      className="h-6 w-6 rounded-full border border-black/10 flex items-center justify-center transition-transform hover:scale-110"
                      style={{ backgroundColor: hex }}
                    >
                      {relColor === hex && <Check className="h-3 w-3 text-white drop-shadow" />}
                    </button>
                  ))}
                  <Input
                    type="color"
                    value={relColor}
                    onChange={(e) => setRelColor(e.target.value)}
                    className="h-7 w-8 p-0 cursor-pointer border rounded"
                    title="Custom color"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rel-notes" className="text-xs">Description / Notes (Optional)</Label>
                <Input
                  id="rel-notes"
                  placeholder="Context for how this relationship type is defined"
                  value={relNotes}
                  onChange={(e) => setRelNotes(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="flex justify-end pt-1">
                <Button
                  size="sm"
                  onClick={() => addRelationshipMutation.mutate()}
                  disabled={!relName.trim() || addRelationshipMutation.isPending}
                  className="h-8 text-xs gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Relationship Type
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: INTERACTIONS */}
        <TabsContent value="interactions" className="space-y-5">
          {/* Current Types */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Current Interaction Types
              </Label>
              <span className="text-xs text-muted-foreground">{interactionTypes.length} active</span>
            </div>

            {isLoadingInt ? (
              <div className="py-4 flex justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading types...
              </div>
            ) : interactionTypes.length === 0 ? (
              <div className="p-4 rounded-lg border border-dashed text-center space-y-2">
                <p className="text-xs text-muted-foreground">No interaction types created yet.</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => seedAllMutation.mutate()}
                  disabled={seedAllMutation.isPending}
                >
                  <Sparkles className="h-3 w-3 text-amber-500" /> Populate standard starter pack
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 p-3 rounded-lg border bg-muted/20">
                {interactionTypes.map((type) => (
                  <div
                    key={type.id}
                    className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border bg-background hover-elevate transition-all group"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0 shadow-sm"
                      style={{ backgroundColor: type.color }}
                    />
                    <span>{type.name}</span>
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.2 rounded">
                      wt {type.value}
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteInteractionMutation.mutate(type.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity ml-0.5"
                      title="Delete type"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Want to add another one? */}
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <Plus className="h-4 w-4 text-primary" /> Want to add another one?
              </CardTitle>
              <CardDescription className="text-xs">
                Add an interaction type for recording touchpoints, meetings, or communications.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="int-name" className="text-xs">Interaction Name *</Label>
                  <Input
                    id="int-name"
                    placeholder="e.g. Dinner, Quick Sync, Podcast Recording"
                    value={intName}
                    onChange={(e) => setIntName(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <Label className="text-xs">Weight (1–255)</Label>
                    <span className="text-xs font-mono font-medium">{intValue}</span>
                  </div>
                  <Slider
                    value={[intValue]}
                    min={1}
                    max={255}
                    step={1}
                    onValueChange={(val) => setIntValue(val[0])}
                    className="py-1"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Color Badge</Label>
                <div className="flex items-center gap-2 flex-wrap">
                  {COLOR_SWATCHES.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setIntColor(hex)}
                      className="h-6 w-6 rounded-full border border-black/10 flex items-center justify-center transition-transform hover:scale-110"
                      style={{ backgroundColor: hex }}
                    >
                      {intColor === hex && <Check className="h-3 w-3 text-white drop-shadow" />}
                    </button>
                  ))}
                  <Input
                    type="color"
                    value={intColor}
                    onChange={(e) => setIntColor(e.target.value)}
                    className="h-7 w-8 p-0 cursor-pointer border rounded"
                    title="Custom color"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="int-desc" className="text-xs">Description (Optional)</Label>
                <Input
                  id="int-desc"
                  placeholder="Notes about when this interaction type is logged"
                  value={intDesc}
                  onChange={(e) => setIntDesc(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="flex justify-end pt-1">
                <Button
                  size="sm"
                  onClick={() => addInteractionMutation.mutate()}
                  disabled={!intName.trim() || addInteractionMutation.isPending}
                  className="h-8 text-xs gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Interaction Type
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: SOCIALS */}
        <TabsContent value="socials" className="space-y-5">
          {/* Current Types */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Current Social Account Platforms
              </Label>
              <span className="text-xs text-muted-foreground">{socialAccountTypes.length} active</span>
            </div>

            {isLoadingSocial ? (
              <div className="py-4 flex justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading types...
              </div>
            ) : socialAccountTypes.length === 0 ? (
              <div className="p-4 rounded-lg border border-dashed text-center space-y-2">
                <p className="text-xs text-muted-foreground">No social account types configured yet.</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => seedAllMutation.mutate()}
                  disabled={seedAllMutation.isPending}
                >
                  <Sparkles className="h-3 w-3 text-amber-500" /> Populate standard platforms
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 p-3 rounded-lg border bg-muted/20">
                {socialAccountTypes.map((type) => (
                  <div
                    key={type.id}
                    className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border bg-background hover-elevate transition-all group"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0 shadow-sm"
                      style={{ backgroundColor: type.color }}
                    />
                    <span>{type.name}</span>
                    <button
                      type="button"
                      onClick={() => deleteSocialMutation.mutate(type.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity ml-0.5"
                      title="Delete platform"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Want to add another one? */}
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <Plus className="h-4 w-4 text-primary" /> Want to add another one?
              </CardTitle>
              <CardDescription className="text-xs">
                Add a new social media platform or profile identifier.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="social-name" className="text-xs">Platform Name *</Label>
                  <Input
                    id="social-name"
                    placeholder="e.g. Mastodon, Telegram, Substack, Discord"
                    value={socialName}
                    onChange={(e) => setSocialName(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Brand / Badge Color</Label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {COLOR_SWATCHES.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => setSocialColor(hex)}
                        className="h-6 w-6 rounded-full border border-black/10 flex items-center justify-center transition-transform hover:scale-110"
                        style={{ backgroundColor: hex }}
                      >
                        {socialColor === hex && <Check className="h-3 w-3 text-white drop-shadow" />}
                      </button>
                    ))}
                    <Input
                      type="color"
                      value={socialColor}
                      onChange={(e) => setSocialColor(e.target.value)}
                      className="h-7 w-8 p-0 cursor-pointer border rounded"
                      title="Custom color"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <Button
                  size="sm"
                  onClick={() => addSocialMutation.mutate()}
                  disabled={!socialName.trim() || addSocialMutation.isPending}
                  className="h-8 text-xs gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Platform
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
