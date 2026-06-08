import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * A pending tool-call awaiting the user's approval. Sent by the server as a
 * `tool_approval_request` event during a streaming chat.
 */
export type ToolApprovalRequest = {
  id: string;
  name: string;
  label: string;
  icon: string;
  args: Record<string, unknown>;
};

type Props = {
  /** Pending request, or null when nothing is awaiting approval. */
  request: ToolApprovalRequest | null;
  /** User decision callback. Called with "accept" or "reject". */
  onDecision: (id: string, decision: "accept" | "reject") => void;
};

/**
 * Lower-left popup (top-center on mobile via responsive classes) that asks
 * the user to authorize an LLM tool call when the AI-tools execution mode is
 * set to "auth". The buttons are colored text only — no filled backgrounds —
 * to keep the popup small per the design spec.
 */
export function ToolApprovalPopup({ request, onDecision }: Props) {
  const [examineOpen, setExamineOpen] = useState(false);

  if (!request) return null;

  const handleAccept = () => onDecision(request.id, "accept");
  const handleReject = () => onDecision(request.id, "reject");

  return (
    <>
      <div
        className={cn(
          // Desktop: anchored to lower-left.
          // Mobile: top-center.
          "fixed z-50 w-[min(92vw,360px)] rounded-lg border bg-background p-3 shadow-lg",
          "left-1/2 top-4 -translate-x-1/2",
          "md:left-4 md:top-auto md:bottom-4 md:translate-x-0",
        )}
        role="dialog"
        aria-label="Change requested"
        data-testid="tool-approval-popup"
      >
        <div className="text-sm font-medium">Change requested</div>
        <div className="mt-1 text-xs text-muted-foreground truncate" data-testid="tool-approval-label">
          {request.label}
        </div>
        <div className="mt-3 flex items-center justify-end gap-3 text-sm font-medium">
          <button
            type="button"
            onClick={handleAccept}
            className="text-emerald-600 hover:underline dark:text-emerald-400"
            data-testid="button-tool-approval-accept"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => setExamineOpen(true)}
            className="text-blue-600 hover:underline dark:text-blue-400"
            data-testid="button-tool-approval-examine"
          >
            Examine
          </button>
          <button
            type="button"
            onClick={handleReject}
            className="text-red-600 hover:underline dark:text-red-400"
            data-testid="button-tool-approval-reject"
          >
            Reject
          </button>
        </div>
      </div>

      <Dialog open={examineOpen} onOpenChange={setExamineOpen}>
        <DialogContent data-testid="dialog-tool-approval-examine">
          <DialogHeader>
            <DialogTitle>Requested change</DialogTitle>
            <DialogDescription>
              The AI is asking to run <span className="font-medium">{request.label}</span>{" "}
              ({request.name}). Review the arguments before deciding.
            </DialogDescription>
          </DialogHeader>
          <pre
            className="max-h-[40vh] overflow-auto rounded-md border bg-muted/40 p-3 text-xs"
            data-testid="text-tool-approval-args"
          >
            {JSON.stringify(request.args, null, 2)}
          </pre>
          <DialogFooter className="flex items-center justify-end gap-3 text-sm font-medium">
            <button
              type="button"
              onClick={() => {
                setExamineOpen(false);
                handleReject();
              }}
              className="text-red-600 hover:underline dark:text-red-400"
              data-testid="button-tool-approval-examine-reject"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => {
                setExamineOpen(false);
                handleAccept();
              }}
              className="text-emerald-600 hover:underline dark:text-emerald-400"
              data-testid="button-tool-approval-examine-accept"
            >
              Accept
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
