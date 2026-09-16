import React, { useState, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Plus, Pencil, Trash2, Compass } from "lucide-react";
import { format, isValid } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Person } from "@shared/schema";

interface PoliticalLeaningCardProps {
  person: Person;
}

export function PoliticalLeaningCard({ person }: PoliticalLeaningCardProps) {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Coordinates range from -10 to +10
  // Left (-10) vs Right (+10)
  // Libertarian (-10) vs Authoritarian (+10)
  const hasData =
    person.politicalLeftRight !== null &&
    person.politicalLeftRight !== undefined &&
    person.politicalLibAuth !== null &&
    person.politicalLibAuth !== undefined;

  // Dialog state values
  const [draftLeftRight, setDraftLeftRight] = useState<number>(0);
  const [draftLibAuth, setDraftLibAuth] = useState<number>(0);

  const openDialog = () => {
    setDraftLeftRight(person.politicalLeftRight ?? 0);
    setDraftLibAuth(person.politicalLibAuth ?? 0);
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    setIsSubmitting(true);
    try {
      await apiRequest("PATCH", `/api/people/${person.id}`, {
        politicalLeftRight: draftLeftRight,
        politicalLibAuth: draftLibAuth,
        politicalUpdatedAt: new Date().toISOString(),
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/people", person.id] });
      toast({
        title: "Political leaning updated",
        description: "The political coordinates have been successfully saved.",
      });
      setIsDialogOpen(false);
    } catch (err: any) {
      toast({
        title: "Failed to update political leaning",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClear = async () => {
    setIsSubmitting(true);
    try {
      await apiRequest("PATCH", `/api/people/${person.id}`, {
        politicalLeftRight: null,
        politicalLibAuth: null,
        politicalUpdatedAt: null,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/people", person.id] });
      toast({
        title: "Political leaning cleared",
        description: "The political leaning data has been removed.",
      });
      setIsDialogOpen(false);
    } catch (err: any) {
      toast({
        title: "Failed to clear political leaning",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Convert coordinates to percentage positions
  // Left (-10) -> 0%, Center (0) -> 50%, Right (+10) -> 100%
  const getLeftPercent = (x: number) => Math.max(0, Math.min(100, ((x + 10) / 20) * 100));
  // Authoritarian (+10) -> 0% (top), Center (0) -> 50%, Libertarian (-10) -> 100% (bottom)
  const getTopPercent = (y: number) => Math.max(0, Math.min(100, ((10 - y) / 20) * 100));

  // Date formatting: Month Day Year (e.g., "June 4 2024")
  const getFormattedDate = () => {
    if (!person.politicalUpdatedAt) return "";
    const d = new Date(person.politicalUpdatedAt);
    if (!isValid(d)) return "";
    return format(d, "MMMM d yyyy");
  };

  return (
    <>
      <Card className="p-4 space-y-3 shadow-none">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-1.5">
            <Compass className="h-4 w-4 text-primary" />
            <span>Political Leaning</span>
          </h3>
        </div>

        {/* 2D Compass Graph Container */}
        <div className="relative w-full aspect-square rounded-lg border overflow-hidden select-none">
          {/* Quadrants Grid */}
          <div
            className={`w-full h-full grid grid-cols-2 grid-rows-2 transition-all duration-200 ${
              !hasData ? "grayscale opacity-40" : ""
            }`}
          >
            {/* Upper Left: Red (Authoritarian Left) */}
            <div className="bg-red-500/25 border-r border-b border-border/70 flex items-start justify-start p-1.5">
              <span className="text-[9px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider opacity-70">
                Auth Left
              </span>
            </div>

            {/* Upper Right: Blue (Authoritarian Right) */}
            <div className="bg-blue-500/25 border-b border-border/70 flex items-start justify-end p-1.5">
              <span className="text-[9px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider opacity-70">
                Auth Right
              </span>
            </div>

            {/* Lower Left: Green (Libertarian Left) */}
            <div className="bg-emerald-500/25 border-r border-border/70 flex items-end justify-start p-1.5">
              <span className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider opacity-70">
                Lib Left
              </span>
            </div>

            {/* Lower Right: Yellow (Libertarian Right) */}
            <div className="bg-amber-400/25 flex items-end justify-end p-1.5">
              <span className="text-[9px] font-semibold text-amber-600 dark:text-amber-300 uppercase tracking-wider opacity-70">
                Lib Right
              </span>
            </div>
          </div>

          {/* Center Crosshairs & Axis Markers */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Horizontal Axis */}
            <div className="absolute top-1/2 left-0 right-0 h-px bg-foreground/30 -translate-y-1/2" />
            {/* Vertical Axis */}
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-foreground/30 -translate-x-1/2" />

            {/* Axis Labels */}
            <div className="absolute top-1 left-1/2 -translate-x-1/2 text-[9px] font-bold text-foreground/70 uppercase tracking-tighter">
              Authoritarian
            </div>
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-bold text-foreground/70 uppercase tracking-tighter">
              Libertarian
            </div>
            <div className="absolute left-1 top-1/2 -translate-y-1/2 text-[9px] font-bold text-foreground/70 uppercase tracking-tighter">
              Left
            </div>
            <div className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] font-bold text-foreground/70 uppercase tracking-tighter">
              Right
            </div>
          </div>

          {/* Populated State: Point plotted on the chart */}
          {hasData && (
            <div
              className="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-300 pointer-events-none z-10"
              style={{
                left: `${getLeftPercent(person.politicalLeftRight!)}%`,
                top: `${getTopPercent(person.politicalLibAuth!)}%`,
              }}
            >
              <div className="relative flex items-center justify-center">
                <span className="animate-ping absolute inline-flex h-4 w-4 rounded-full bg-red-400 opacity-75" />
                <div className="relative h-4 w-4 rounded-full bg-red-600 border-2 border-white dark:border-zinc-900 shadow-md" />
              </div>
            </div>
          )}

          {/* Empty State: Centered Add Button */}
          {!hasData && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <Button
                size="sm"
                onClick={openDialog}
                className="shadow-md font-medium text-xs h-8 px-3"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add
              </Button>
            </div>
          )}
        </div>

        {/* Footer info: Timestamp on left, smaller edit button on right */}
        {hasData && (
          <div className="flex items-center justify-between pt-1 text-xs">
            <span className="text-muted-foreground text-[11px] font-medium">
              {getFormattedDate()}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={openDialog}
              className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-3 w-3 mr-1" />
              Edit
            </Button>
          </div>
        )}
      </Card>

      {/* Edit / Add Dialog */}
      <PoliticalLeaningDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        hasExistingData={hasData}
        leftRight={draftLeftRight}
        libAuth={draftLibAuth}
        onLeftRightChange={setDraftLeftRight}
        onLibAuthChange={setDraftLibAuth}
        onSave={handleSave}
        onClear={handleClear}
        isSubmitting={isSubmitting}
      />
    </>
  );
}

interface PoliticalLeaningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasExistingData: boolean;
  leftRight: number;
  libAuth: number;
  onLeftRightChange: (val: number) => void;
  onLibAuthChange: (val: number) => void;
  onSave: () => void;
  onClear: () => void;
  isSubmitting: boolean;
}

function PoliticalLeaningDialog({
  open,
  onOpenChange,
  hasExistingData,
  leftRight,
  libAuth,
  onLeftRightChange,
  onLibAuthChange,
  onSave,
  onClear,
  isSubmitting,
}: PoliticalLeaningDialogProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const updateCoordinatesFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      if (!chartRef.current) return;
      const rect = chartRef.current.getBoundingClientRect();
      const xPercent = (clientX - rect.left) / rect.width;
      const yPercent = (clientY - rect.top) / rect.height;

      // Clamp between 0 and 1
      const clampedX = Math.max(0, Math.min(1, xPercent));
      const clampedY = Math.max(0, Math.min(1, yPercent));

      // Map to -10 .. +10
      // X: 0 -> -10, 1 -> +10
      const newX = Math.round((clampedX * 20 - 10) * 10) / 10;
      // Y: 0 -> +10 (Authoritarian), 1 -> -10 (Libertarian)
      const newY = Math.round(((1 - clampedY) * 20 - 10) * 10) / 10;

      onLeftRightChange(newX);
      onLibAuthChange(newY);
    },
    [onLeftRightChange, onLibAuthChange]
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

  // Determine quadrant label
  const getQuadrantLabel = () => {
    const authText = libAuth > 1 ? "Authoritarian" : libAuth < -1 ? "Libertarian" : "Centrist";
    const lrText = leftRight < -1 ? "Left" : leftRight > 1 ? "Right" : "Centrist";
    if (authText === "Centrist" && lrText === "Centrist") return "Moderate / Centrist";
    if (authText === "Centrist") return `Centrist ${lrText}`;
    if (lrText === "Centrist") return `${authText} Centrist`;
    return `${authText} ${lrText}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-primary" />
            <span>Political Leaning</span>
          </DialogTitle>
          <DialogDescription>
            Click or drag on the compass chart below, or use the sliders to specify coordinates (-10 to +10).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Current Classification Badge */}
          <div className="flex items-center justify-between text-xs bg-muted/50 p-2.5 rounded-md">
            <span className="font-semibold text-foreground">{getQuadrantLabel()}</span>
            <span className="text-muted-foreground font-mono">
              ({leftRight >= 0 ? `+${leftRight}` : leftRight}, {libAuth >= 0 ? `+${libAuth}` : libAuth})
            </span>
          </div>

          {/* Interactive Chart */}
          <div
            ref={chartRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="relative w-full aspect-square rounded-lg border overflow-hidden select-none cursor-crosshair touch-none shadow-inner"
          >
            {/* Quadrants Grid */}
            <div className="w-full h-full grid grid-cols-2 grid-rows-2">
              {/* Upper Left: Red */}
              <div className="bg-red-500/25 border-r border-b border-border/70 flex items-start justify-start p-2">
                <span className="text-[10px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider opacity-80">
                  Auth Left
                </span>
              </div>
              {/* Upper Right: Blue */}
              <div className="bg-blue-500/25 border-b border-border/70 flex items-start justify-end p-2">
                <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider opacity-80">
                  Auth Right
                </span>
              </div>
              {/* Lower Left: Green */}
              <div className="bg-emerald-500/25 border-r border-border/70 flex items-end justify-start p-2">
                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider opacity-80">
                  Lib Left
                </span>
              </div>
              {/* Lower Right: Yellow */}
              <div className="bg-amber-400/25 flex items-end justify-end p-2">
                <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-300 uppercase tracking-wider opacity-80">
                  Lib Right
                </span>
              </div>
            </div>

            {/* Grid markings */}
            <div className="absolute inset-0 pointer-events-none">
              {/* Axis lines */}
              <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-foreground/40 -translate-y-1/2" />
              <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-foreground/40 -translate-x-1/2" />

              {/* Axis Labels */}
              <div className="absolute top-1.5 left-1/2 -translate-x-1/2 text-[10px] font-bold text-foreground uppercase tracking-wider bg-background/60 px-1.5 py-0.5 rounded">
                Authoritarian (+10)
              </div>
              <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[10px] font-bold text-foreground uppercase tracking-wider bg-background/60 px-1.5 py-0.5 rounded">
                Libertarian (-10)
              </div>
              <div className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-foreground uppercase tracking-wider bg-background/60 px-1.5 py-0.5 rounded">
                Left (-10)
              </div>
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-foreground uppercase tracking-wider bg-background/60 px-1.5 py-0.5 rounded">
                Right (+10)
              </div>
            </div>

            {/* Placed Marker */}
            <div
              className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20"
              style={{
                left: `${getLeftPercent(leftRight)}%`,
                top: `${getTopPercent(libAuth)}%`,
              }}
            >
              <div className="relative flex items-center justify-center">
                <div className="h-5 w-5 rounded-full bg-red-600 border-2 border-white shadow-xl flex items-center justify-center">
                  <div className="h-1.5 w-1.5 bg-white rounded-full" />
                </div>
              </div>
            </div>
          </div>

          {/* Sliders for precision input */}
          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Left vs Right (Economic)</span>
                <span className="font-mono font-medium">{leftRight >= 0 ? `+${leftRight}` : leftRight}</span>
              </div>
              <Slider
                min={-10}
                max={10}
                step={0.5}
                value={[leftRight]}
                onValueChange={([val]) => onLeftRightChange(val)}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Left (-10)</span>
                <span>Center (0)</span>
                <span>Right (+10)</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Libertarian vs Authoritarian (Social)</span>
                <span className="font-mono font-medium">{libAuth >= 0 ? `+${libAuth}` : libAuth}</span>
              </div>
              <Slider
                min={-10}
                max={10}
                step={0.5}
                value={[libAuth]}
                onValueChange={([val]) => onLibAuthChange(val)}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Libertarian (-10)</span>
                <span>Center (0)</span>
                <span>Authoritarian (+10)</span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between pt-2">
          {hasExistingData ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              disabled={isSubmitting}
              className="text-destructive hover:text-destructive hover:bg-destructive/10 text-xs"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Clear
            </Button>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onSave}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
