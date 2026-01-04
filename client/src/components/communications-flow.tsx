import { useState } from "react";
import { format } from "date-fns";
import { MessageSquare, Plus, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CommunicationWithType } from "@shared/schema";

interface CommunicationsFlowProps {
  communications: CommunicationWithType[];
  personId: string;
  onAddCommunication: () => void;
  onSelectCommunication: (communication: CommunicationWithType) => void;
}

export function CommunicationsFlow({
  communications,
  personId,
  onAddCommunication,
  onSelectCommunication,
}: CommunicationsFlowProps) {
  if (communications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <MessageSquare className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium mb-2">No communications yet</h3>
        <p className="text-muted-foreground mb-6 max-w-sm">
          Track messages, emails, and other communications with this person.
        </p>
        <Button onClick={onAddCommunication} data-testid="button-add-first-communication">
          <Plus className="h-4 w-4" />
          Add Communication
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b">
        <h3 className="font-medium">Communications Flow</h3>
        <Button
          size="sm"
          onClick={onAddCommunication}
          data-testid="button-add-communication"
        >
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-3">
        {communications.map((comm) => {
          const isInbound = comm.direction === "inbound";
          const bgColor = comm.type?.color || "#6b7280";
          
          return (
            <div
              key={comm.id}
              className={`flex ${isInbound ? "justify-start" : "justify-end"}`}
            >
              <div
                className={`
                  max-w-[80%] p-3 rounded-lg cursor-pointer
                  hover-elevate transition-all
                  ${isInbound ? "rounded-tl-none" : "rounded-tr-none"}
                `}
                style={{
                  backgroundColor: bgColor + "20",
                  borderLeft: isInbound ? `3px solid ${bgColor}` : undefined,
                  borderRight: !isInbound ? `3px solid ${bgColor}` : undefined,
                }}
                onClick={() => onSelectCommunication(comm)}
                data-testid={`communication-bubble-${comm.id}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {isInbound ? (
                    <ArrowDownLeft className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <ArrowUpRight className="h-3 w-3 text-muted-foreground" />
                  )}
                  <span
                    className="text-xs font-medium px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: bgColor, color: "white" }}
                  >
                    {comm.type?.name || "Unknown"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(comm.date), "MMM d, yyyy h:mm a")}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap break-words">
                  {comm.content}
                </p>
                {comm.notes && (
                  <p className="text-xs text-muted-foreground mt-2 italic">
                    {comm.notes}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
