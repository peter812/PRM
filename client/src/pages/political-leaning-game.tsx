import React, { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Compass,
  ArrowLeft,
  SkipForward,
  Check,
  PartyPopper,
  Loader2,
  ExternalLink,
  RotateCcw,
  Users,
  Briefcase,
  GraduationCap,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import type { Person } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getInitials } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type NextPersonResponse = {
  person: Person | null;
  remainingCount: number;
};

export default function PoliticalLeaningGame() {
  const { toast } = useToast();
  const [skipped, setSkipped] = useState<string[]>([]);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [leftRight, setLeftRight] = useState<number>(0);
  const [libAuth, setLibAuth] = useState<number>(0);

  const chartRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Fetch next unrated person
  const queryKey = [`/api/political-leaning/next?exclude=${skipped.join(",")}`];
  const { data, isLoading, isError, error, refetch } = useQuery<NextPersonResponse>({
    queryKey,
    staleTime: 0,
    gcTime: 0,
  });

  const person = data?.person ?? null;
  const remainingCount = data?.remainingCount ?? 0;

  // Reset coordinates when new person appears
  useEffect(() => {
    setLeftRight(0);
    setLibAuth(0);
    setHasInteracted(false);
  }, [person?.id]);

  const saveMutation = useMutation({
    mutationFn: async ({ id, x, y }: { id: string; x: number; y: number }) => {
      await apiRequest("PATCH", `/api/people/${id}`, {
        politicalLeftRight: x,
        politicalLibAuth: y,
        politicalUpdatedAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      toast({
        title: "Saved!",
        description: `Set political leaning for ${person?.firstName} ${person?.lastName}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      refetch();
    },
    onError: (err: any) => {
      toast({
        title: "Error saving",
        description: err.message || "Failed to save political leaning.",
        variant: "destructive",
      });
    },
  });

  const handleSkip = () => {
    if (!person) return;
    setSkipped((prev) => [...prev, person.id]);
  };

  const handleSave = () => {
    if (!person || saveMutation.isPending) return;
    saveMutation.mutate({ id: person.id, x: leftRight, y: libAuth });
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is in an input or dialog
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        handleSkip();
      } else if (e.key === "Enter" && hasInteracted) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [person, leftRight, libAuth, hasInteracted, saveMutation.isPending]);

  // Pointer dragging on chart
  const updateCoordinatesFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      if (!chartRef.current) return;
      const rect = chartRef.current.getBoundingClientRect();
      const xPercent = (clientX - rect.left) / rect.width;
      const yPercent = (clientY - rect.top) / rect.height;

      const clampedX = Math.max(0, Math.min(1, xPercent));
      const clampedY = Math.max(0, Math.min(1, yPercent));

      const newX = Math.round((clampedX * 20 - 10) * 10) / 10;
      const newY = Math.round(((1 - clampedY) * 20 - 10) * 10) / 10;

      setLeftRight(newX);
      setLibAuth(newY);
      setHasInteracted(true);
    },
    []
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    updateCoordinatesFromPointer(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      updateCoordinatesFromPointer(e.clientX, e.clientY);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const getLeftPercent = (x: number) => Math.max(0, Math.min(100, ((x + 10) / 20) * 100));
  const getTopPercent = (y: number) => Math.max(0, Math.min(100, ((10 - y) / 20) * 100));

  const getQuadrantLabel = () => {
    if (!hasInteracted) return "Click or drag to place stance";
    const authText = libAuth > 1 ? "Authoritarian" : libAuth < -1 ? "Libertarian" : "Centrist";
    const lrText = leftRight < -1 ? "Left" : leftRight > 1 ? "Right" : "Centrist";
    if (authText === "Centrist" && lrText === "Centrist") return "Moderate / Centrist";
    if (authText === "Centrist") return `Centrist ${lrText}`;
    if (lrText === "Centrist") return `${authText} Centrist`;
    return `${authText} ${lrText}`;
  };

  return (
    <div className="container mx-auto p-4 max-w-5xl space-y-6 mt-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild className="h-8 px-2">
            <Link href="/games">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Games
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Compass className="h-6 w-6 text-primary" />
              Political Leaning
            </h1>
            <p className="text-xs text-muted-foreground">
              Rate the political leanings of people in your network on the 2D political compass.
            </p>
          </div>
        </div>

        {remainingCount > 0 && (
          <Badge variant="secondary" className="self-start sm:self-auto gap-1 text-xs py-1 px-2.5">
            <Users className="h-3.5 w-3.5" />
            <span>{remainingCount} unrated remaining</span>
          </Badge>
        )}
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Finding the next profile...</p>
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
          <p className="text-destructive font-semibold">Error loading profile</p>
          <p className="text-sm text-muted-foreground">{(error as any)?.message || "Something went wrong"}</p>
          <Button onClick={() => refetch()} variant="outline">
            Try Again
          </Button>
        </div>
      ) : !person ? (
        /* Empty / Completed State */
        <Card className="max-w-lg mx-auto text-center p-8 space-y-6">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            <PartyPopper className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">All Caught Up!</h2>
            <p className="text-sm text-muted-foreground">
              {skipped.length > 0
                ? `You have rated all available people, and skipped ${skipped.length} ${
                    skipped.length === 1 ? "person" : "people"
                  } in this session.`
                : "Every person in your network now has their political leaning recorded!"}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {skipped.length > 0 && (
              <Button onClick={() => setSkipped([])} variant="outline" className="gap-2">
                <RotateCcw className="h-4 w-4" />
                Review Skipped ({skipped.length})
              </Button>
            )}
            <Button asChild>
              <Link href="/games">Back to Games</Link>
            </Button>
          </div>
        </Card>
      ) : (
        /* Active Game Layout */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Person Context Card */}
          <div className="lg:col-span-5 space-y-4">
            <Card className="overflow-hidden">
              <div className="p-6 space-y-5">
                {/* Profile Photo & Names */}
                <div className="flex items-center gap-4">
                  <Avatar className="h-20 w-20 rounded-xl border-2 shadow-sm">
                    {person.imageUrl ? (
                      <AvatarImage
                        src={person.imageUrl}
                        alt={`${person.firstName} ${person.lastName}`}
                        className="object-cover"
                      />
                    ) : null}
                    <AvatarFallback className="rounded-xl text-xl font-bold bg-primary/10 text-primary">
                      {getInitials(person.firstName, person.lastName)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="space-y-1 min-w-0 flex-1">
                    <h2 className="text-xl font-bold truncate">
                      {person.firstName} {person.lastName}
                    </h2>
                    {person.maidenName && (
                      <p className="text-xs text-muted-foreground">
                        Maiden Name: {person.maidenName}
                      </p>
                    )}
                    {(person.title || person.company) && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5 truncate">
                        <Briefcase className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          {person.title} {person.title && person.company && "at"} {person.company}
                        </span>
                      </p>
                    )}
                  </div>
                </div>

                {/* Additional Info / Context */}
                <div className="space-y-3 pt-2 border-t text-xs">
                  {person.jobs && person.jobs.length > 0 && (
                    <div className="space-y-1">
                      <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider block">
                        Recent Employment
                      </span>
                      <p className="font-medium text-foreground">
                        {person.jobs[0].position ? `${person.jobs[0].position} — ` : ""}
                        {person.jobs[0].company}
                      </p>
                    </div>
                  )}

                  {person.tags && person.tags.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider block flex items-center gap-1">
                        <Tag className="h-3 w-3" /> Tags
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {person.tags.map((t, idx) => (
                          <Badge key={idx} variant="outline" className="text-[10px] py-0 px-2">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-2">
                  <Button variant="outline" size="sm" asChild className="w-full text-xs h-8">
                    <a
                      href={`/person/${person.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open Full Profile
                    </a>
                  </Button>
                </div>
              </div>
            </Card>

            {/* Keyboard shortcut hint */}
            <div className="text-center text-[11px] text-muted-foreground bg-muted/40 p-2.5 rounded-lg">
              <span>Shortcuts: Press </span>
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-background border rounded shadow-sm">
                S
              </kbd>
              <span> to skip, </span>
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-background border rounded shadow-sm">
                Enter
              </kbd>
              <span> to save & next</span>
            </div>
          </div>

          {/* Right Column: 2D Political Compass Interactive Chart */}
          <div className="lg:col-span-7 space-y-4">
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm">Position on Political Compass</h3>
                  <p className="text-xs text-muted-foreground">
                    Click anywhere on the chart or use the sliders below.
                  </p>
                </div>

                {/* Stance Indicator Badge */}
                <Badge
                  variant={hasInteracted ? "default" : "outline"}
                  className="font-mono text-xs py-1 px-2.5 transition-colors"
                >
                  {getQuadrantLabel()}
                  {hasInteracted &&
                    ` (${leftRight >= 0 ? `+${leftRight}` : leftRight}, ${
                      libAuth >= 0 ? `+${libAuth}` : libAuth
                    })`}
                </Badge>
              </div>

              {/* 2D Compass Interactive Container */}
              <div
                ref={chartRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                className="relative w-full aspect-square max-w-[440px] mx-auto rounded-xl border overflow-hidden select-none cursor-crosshair touch-none shadow-md"
              >
                {/* 4 Quadrants Grid */}
                <div className="w-full h-full grid grid-cols-2 grid-rows-2">
                  {/* Upper Left: Red (Authoritarian Left) */}
                  <div className="bg-red-500/25 border-r border-b border-border/70 flex items-start justify-start p-3">
                    <span className="text-[11px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wider opacity-85">
                      Auth Left
                    </span>
                  </div>

                  {/* Upper Right: Blue (Authoritarian Right) */}
                  <div className="bg-blue-500/25 border-b border-border/70 flex items-start justify-end p-3">
                    <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider opacity-85">
                      Auth Right
                    </span>
                  </div>

                  {/* Lower Left: Green (Libertarian Left) */}
                  <div className="bg-emerald-500/25 border-r border-border/70 flex items-end justify-start p-3">
                    <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider opacity-85">
                      Lib Left
                    </span>
                  </div>

                  {/* Lower Right: Yellow (Libertarian Right) */}
                  <div className="bg-amber-400/25 flex items-end justify-end p-3">
                    <span className="text-[11px] font-bold text-amber-600 dark:text-amber-300 uppercase tracking-wider opacity-85">
                      Lib Right
                    </span>
                  </div>
                </div>

                {/* Axes and Labels */}
                <div className="absolute inset-0 pointer-events-none">
                  {/* Horizontal Axis (X=0) */}
                  <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-foreground/40 -translate-y-1/2" />
                  {/* Vertical Axis (Y=0) */}
                  <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-foreground/40 -translate-x-1/2" />

                  {/* Labels on sides */}
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-wider bg-background/80 px-2 py-0.5 rounded shadow-sm">
                    Authoritarian (+10)
                  </div>
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-wider bg-background/80 px-2 py-0.5 rounded shadow-sm">
                    Libertarian (-10)
                  </div>
                  <div className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-wider bg-background/80 px-2 py-0.5 rounded shadow-sm">
                    Left (-10)
                  </div>
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-wider bg-background/80 px-2 py-0.5 rounded shadow-sm">
                    Right (+10)
                  </div>
                </div>

                {/* Placed Point Marker */}
                {hasInteracted && (
                  <div
                    className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20"
                    style={{
                      left: `${getLeftPercent(leftRight)}%`,
                      top: `${getTopPercent(libAuth)}%`,
                    }}
                  >
                    <div className="relative flex items-center justify-center">
                      <span className="animate-ping absolute inline-flex h-5 w-5 rounded-full bg-red-400 opacity-75" />
                      <div className="relative h-5 w-5 rounded-full bg-red-600 border-2 border-white dark:border-zinc-900 shadow-xl flex items-center justify-center">
                        <div className="h-1.5 w-1.5 bg-white rounded-full" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Center prompt when not interacted yet */}
                {!hasInteracted && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="bg-background/80 backdrop-blur-xs text-xs font-semibold px-3 py-1.5 rounded-full shadow-sm text-foreground/80">
                      Click anywhere to place
                    </span>
                  </div>
                )}
              </div>

              {/* Coordinate Sliders */}
              <div className="space-y-3 pt-2">
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground font-medium">
                      Left vs Right (Economic Spectrum)
                    </span>
                    <span className="font-mono font-bold">
                      {leftRight >= 0 ? `+${leftRight}` : leftRight}
                    </span>
                  </div>
                  <Slider
                    min={-10}
                    max={10}
                    step={0.5}
                    value={[leftRight]}
                    onValueChange={([val]) => {
                      setLeftRight(val);
                      setHasInteracted(true);
                    }}
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Left (-10)</span>
                    <span>Center (0)</span>
                    <span>Right (+10)</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground font-medium">
                      Libertarian vs Authoritarian (Social Spectrum)
                    </span>
                    <span className="font-mono font-bold">
                      {libAuth >= 0 ? `+${libAuth}` : libAuth}
                    </span>
                  </div>
                  <Slider
                    min={-10}
                    max={10}
                    step={0.5}
                    value={[libAuth]}
                    onValueChange={([val]) => {
                      setLibAuth(val);
                      setHasInteracted(true);
                    }}
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Libertarian (-10)</span>
                    <span>Center (0)</span>
                    <span>Authoritarian (+10)</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons: Skip & Save */}
              <div className="flex items-center justify-between pt-4 border-t gap-3">
                <Button
                  variant="outline"
                  onClick={handleSkip}
                  disabled={saveMutation.isPending}
                  className="gap-1.5"
                >
                  <SkipForward className="h-4 w-4" />
                  Skip Person
                </Button>

                <Button
                  onClick={handleSave}
                  disabled={!hasInteracted || saveMutation.isPending}
                  className="gap-1.5 min-w-[140px]"
                >
                  {saveMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      Save & Next
                    </>
                  )}
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
