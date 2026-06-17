import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Loader2, Maximize, ExternalLink } from "lucide-react";
import { FamilyTreeCanvas, FamilyTreeData, FamilyTreeCanvasHandle } from "@/components/family-tree-canvas";
import { AddFamilyMemberDialog } from "@/components/add-family-member-dialog";
import { apiRequest } from "@/lib/queryClient";

interface FamilyTreeTabProps {
  personId: string;
  personName?: string;
}

export function FamilyTreeTab({ personId, personName }: FamilyTreeTabProps) {
  const [, navigate] = useLocation();
  const [depth, setDepth] = useState(3);
  const canvasRef = useRef<FamilyTreeCanvasHandle>(null);
  const [addMemberContext, setAddMemberContext] = useState<{
    relatedPersonId: string;
    suggestedRole: string;
  } | null>(null);

  const { data: treeData, isLoading } = useQuery<FamilyTreeData>({
    queryKey: ["/api/family-tree", personId, depth],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/family-tree/${personId}?depth=${depth}`);
      return res.json();
    },
    enabled: !!personId,
  });

  const { data: allPeople } = useQuery<Array<{ id: string; firstName: string; lastName: string }>>({
    queryKey: ["/api/people"],
  });

  const handlePersonClick = (pid: string) => {
    // Per UX request, clicking a person in the family tree should not navigate
    // to that person's profile page. Within the embedded tab the easiest way
    // to "explore" another person is via the Full Tree page, so we intentionally
    // make this a no-op here.
    void pid;
  };

  const handleAddMember = (relatedPersonId: string, suggestedRole: string) => {
    setAddMemberContext({ relatedPersonId, suggestedRole });
  };

  const relatedPerson = addMemberContext
    ? allPeople?.find((p) => p.id === addMemberContext.relatedPersonId)
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Tab controls */}
      <div className="px-4 py-2 flex items-center gap-3 border-b">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Depth: {depth}</span>
          <Slider
            value={[depth]}
            min={1}
            max={10}
            step={1}
            onValueChange={([v]) => setDepth(v)}
            className="w-20"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => canvasRef.current?.fitToScreen()}
        >
          <Maximize className="h-3 w-3 mr-1" />
          Fit
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/family-tree?person=${personId}&depth=6`)}
          className="ml-auto"
        >
          <ExternalLink className="h-3 w-3 mr-1" />
          Full Tree
        </Button>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative min-h-[300px] bg-background">
        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {treeData && !isLoading && (
          <FamilyTreeCanvas
            ref={canvasRef}
            data={treeData}
            onPersonClick={handlePersonClick}
            onAddMember={handleAddMember}
          />
        )}
        {!isLoading && !treeData && (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No family tree data available
          </div>
        )}
      </div>

      {addMemberContext && (
        <AddFamilyMemberDialog
          open={!!addMemberContext}
          onOpenChange={(open) => {
            if (!open) setAddMemberContext(null);
          }}
          relatedPersonId={addMemberContext.relatedPersonId}
          relatedPersonName={
            relatedPerson
              ? `${relatedPerson.firstName} ${relatedPerson.lastName}`.trim()
              : undefined
          }
          suggestedRole={addMemberContext.suggestedRole}
          onSuccess={() => setAddMemberContext(null)}
        />
      )}
    </div>
  );
}
