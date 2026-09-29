import { useState, useEffect, lazy, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import {
  HardDrive,
  Brain,
  Layers,
  Radar,
  Sparkles,
  Upload,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  X,
  Loader2,
} from "lucide-react";

const StageServices = lazy(() =>
  import("./setup-stages/stage-services").then((m) => ({ default: m.StageServices }))
);
const StageAi = lazy(() =>
  import("./setup-stages/stage-ai").then((m) => ({ default: m.StageAi }))
);
const StageDataTypes = lazy(() =>
  import("./setup-stages/stage-data-types").then((m) => ({ default: m.StageDataTypes }))
);
const StageTracking = lazy(() =>
  import("./setup-stages/stage-tracking").then((m) => ({ default: m.StageTracking }))
);
const StageExperimental = lazy(() =>
  import("./setup-stages/stage-experimental").then((m) => ({ default: m.StageExperimental }))
);
const StageImportContacts = lazy(() =>
  import("./setup-stages/stage-import-contacts").then((m) => ({ default: m.StageImportContacts }))
);
const StageCompletion = lazy(() =>
  import("./setup-stages/stage-completion").then((m) => ({ default: m.StageCompletion }))
);

export interface UnifiedSetupProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  inline?: boolean;
  initialStep?: number;
  onFinish?: () => void;
}

const STAGES = [
  {
    id: "services",
    title: "Sub-Services",
    description: "S3, Face, Ollama & Qdrant",
    icon: HardDrive,
  },
  {
    id: "ai",
    title: "AI Intelligence",
    description: "LLMs, Vectors & Speech",
    icon: Brain,
  },
  {
    id: "data-types",
    title: "Data Types",
    description: "Relationships & Interactions",
    icon: Layers,
  },
  {
    id: "tracking",
    title: "Tracking & Settings",
    description: "Cadences & Graph Options",
    icon: Radar,
  },
  {
    id: "experimental",
    title: "Experimental",
    description: "Labs & Demos Flags",
    icon: Sparkles,
  },
  {
    id: "import",
    title: "Import Contacts",
    description: "Google CSV & Apple VCF",
    icon: Upload,
  },
  {
    id: "complete",
    title: "Ready",
    description: "Review & Next Steps",
    icon: CheckCircle2,
  },
];

export function UnifiedSetupContent({
  initialStep = 0,
  onFinish,
  onClose,
}: {
  initialStep?: number;
  onFinish?: () => void;
  onClose?: () => void;
}) {
  const [currentStep, setCurrentStep] = useState(initialStep);
  const queryClient = useQueryClient();

  const markCompletedMutation = useMutation({
    mutationFn: async (completed: boolean) => {
      await apiRequest("POST", "/api/setup/onboarding-status", {
        completed,
        dismissed: true,
        currentStep,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/setup/onboarding-status"] });
    },
  });

  const handleNext = () => {
    if (currentStep < STAGES.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      markCompletedMutation.mutate(true);
      if (onFinish) onFinish();
      if (onClose) onClose();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleSkip = () => {
    handleNext();
  };

  const handleClose = () => {
    markCompletedMutation.mutate(false);
    if (onClose) onClose();
  };

  const activeStage = STAGES[currentStep];

  return (
    <div className="flex flex-col md:flex-row h-full max-h-[88vh] overflow-hidden bg-background">
      {/* Left Stepper Sidebar (Desktop) */}
      <div className="w-full md:w-64 border-b md:border-b-0 md:border-r bg-muted/20 p-4 flex flex-col justify-between shrink-0">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-sm tracking-tight">Unified Setup</h2>
              <p className="text-[11px] text-muted-foreground">People Manager Assistant</p>
            </div>
            <Badge variant="outline" className="text-[10px] h-5">
              Step {currentStep + 1} of {STAGES.length}
            </Badge>
          </div>

          {/* Stepper Navigation */}
          <nav className="flex md:flex-col gap-1 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
            {STAGES.map((stage, idx) => {
              const Icon = stage.icon;
              const isActive = idx === currentStep;
              const isPast = idx < currentStep;

              return (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => setCurrentStep(idx)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all shrink-0 md:shrink text-xs ${
                    isActive
                      ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                      : isPast
                      ? "text-foreground hover:bg-muted font-medium"
                      : "text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <div
                    className={`p-1 rounded-md shrink-0 ${
                      isActive
                        ? "bg-primary-foreground/20 text-primary-foreground"
                        : isPast
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isPast ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                  </div>
                  <div className="min-w-0 hidden md:block">
                    <div className="truncate text-xs leading-none mb-0.5">{stage.title}</div>
                    <div
                      className={`truncate text-[10px] ${
                        isActive ? "text-primary-foreground/80" : "text-muted-foreground"
                      }`}
                    >
                      {stage.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="hidden md:block pt-4 border-t text-[11px] text-muted-foreground">
          You can jump between stages anytime. Your changes save instantly.
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col justify-between overflow-hidden">
        {/* Stage Content Scroll Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-48">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            }
          >
            {activeStage.id === "services" && <StageServices />}
            {activeStage.id === "ai" && <StageAi />}
            {activeStage.id === "data-types" && <StageDataTypes />}
            {activeStage.id === "tracking" && <StageTracking />}
            {activeStage.id === "experimental" && <StageExperimental />}
            {activeStage.id === "import" && <StageImportContacts />}
            {activeStage.id === "complete" && <StageCompletion onFinish={handleNext} />}
          </Suspense>
        </div>

        {/* Footer Navigation Bar */}
        <div className="p-3 md:p-4 border-t bg-background/95 backdrop-blur flex items-center justify-between gap-3 shrink-0">
          <div>
            {currentStep > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrev}
                className="gap-1 h-8 text-xs"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Back
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {currentStep < STAGES.length - 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSkip}
                className="text-xs text-muted-foreground hover:text-foreground h-8"
              >
                Skip Step
              </Button>
            )}

            <Button
              size="sm"
              onClick={handleNext}
              className="gap-1 h-8 text-xs"
            >
              {currentStep === STAGES.length - 1 ? (
                <>Finish Setup <CheckCircle2 className="h-3.5 w-3.5 ml-1" /></>
              ) : (
                <>Next: {STAGES[currentStep + 1]?.title} <ChevronRight className="h-3.5 w-3.5 ml-1" /></>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function UnifiedSetupDialog({
  open = false,
  onOpenChange,
  inline = false,
  initialStep = 0,
  onFinish,
}: UnifiedSetupProps) {
  if (inline) {
    return (
      <div className="w-full h-full border rounded-xl overflow-hidden shadow-sm">
        <UnifiedSetupContent initialStep={initialStep} onFinish={onFinish} />
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden border-border sm:max-h-[90vh]">
        <DialogHeader className="sr-only">
          <DialogTitle>Unified Setup Assistant</DialogTitle>
          <DialogDescription>Setup PRM services, tracking, data types, and AI.</DialogDescription>
        </DialogHeader>
        <UnifiedSetupContent
          initialStep={initialStep}
          onFinish={onFinish}
          onClose={() => onOpenChange?.(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
