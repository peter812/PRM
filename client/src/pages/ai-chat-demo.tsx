import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { MarkdownMessage } from "@/components/markdown-message";
import { ToolApprovalPopup, type ToolApprovalRequest } from "@/components/tool-approval-popup";
import {
  Loader2,
  Plus,
  Send,
  Settings,
  Trash2,
  MessagesSquare,
  Bot,
  User as UserIcon,
  Pencil,
  GitBranch,
  Paperclip,
  FileText,
  X,
  Search,
  AtSign,
  Book,
  NotebookPen,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Link2,
  type LucideIcon,
} from "lucide-react";

type ChatAttachment = {
  name: string;
  type: string;
  content: string;
};

type ToolCallTrace = {
  name: string;
  icon: string;
  label: string;
  args: Record<string, unknown>;
  summary: string;
  ok: boolean;
  /** Local-only: true while the call is in flight, false once a result has arrived. */
  pending?: boolean;
  /** Stable id assigned by the server stream (only present during live streaming). */
  id?: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
  toolCalls?: ToolCallTrace[];
  links?: { url: string; title: string }[];
};

// Map from server-side icon keys (see server/ai-tools.ts) to Lucide components.
const TOOL_ICON_MAP: Record<string, LucideIcon> = {
  search: Search,
  user: UserIcon,
  "user-search": UserIcon,
  "at-sign": AtSign,
  "at-sign-search": AtSign,
  book: Book,
  notebook: NotebookPen,
  "message-square": MessageSquare,
};

/**
 * Renders one tool-call step as a full row: icon + label + arg summary on the
 * left, spinner while pending, then result summary (with success/error icon) once
 * the result has arrived.
 */
function ThoughtChainSteps({ calls, dataTestidPrefix }: { calls: ToolCallTrace[]; dataTestidPrefix: string }) {
  return (
    <div className="flex flex-col gap-1" data-testid={`${dataTestidPrefix}-thought-chain`}>
      {calls.map((c, i) => {
        const Icon = TOOL_ICON_MAP[c.icon] ?? Search;
        const argStr = Object.values(c.args ?? {})
          .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
          .filter(Boolean)
          .join(", ");
        return (
          <div
            key={c.id ?? i}
            className="flex items-center gap-2 text-xs"
            data-testid={`${dataTestidPrefix}-thought-step-${i}`}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
              <Icon className="h-3 w-3" />
            </span>
            <span className="flex-1 truncate text-muted-foreground">
              <span className="font-medium text-foreground/80">{c.label}</span>
              {argStr ? <span>: {argStr}</span> : null}
            </span>
            <span className="shrink-0">
              {c.pending ? (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              ) : c.ok ? (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <CheckCircle2 className="h-3 w-3 text-green-500 dark:text-green-400" />
                  {c.summary ? <span className="max-w-[180px] truncate">{c.summary}</span> : null}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-destructive">
                  <XCircle className="h-3 w-3" />
                  {c.summary ? <span className="max-w-[180px] truncate">{c.summary}</span> : null}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Live thought-chain: shown during streaming with all steps expanded so the user
 * can watch them build in real time.
 *
 * History thought-chain: shown on completed messages as a collapsed toggle
 * ("N tools used ▸") that expands on click.
 */
function ThoughtChain({
  calls,
  live = false,
  dataTestidPrefix,
}: {
  calls: ToolCallTrace[];
  live?: boolean;
  dataTestidPrefix: string;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!calls || calls.length === 0) return null;

  if (live) {
    return (
      <div className="mb-3 rounded-md border bg-background/60 px-3 py-2" data-testid={`${dataTestidPrefix}-tool-live`}>
        <ThoughtChainSteps calls={calls} dataTestidPrefix={dataTestidPrefix} />
      </div>
    );
  }

  return (
    <div className="mb-2" data-testid={`${dataTestidPrefix}-tool-history`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        data-testid={`${dataTestidPrefix}-tool-toggle`}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {calls.length} tool{calls.length !== 1 ? "s" : ""} used
      </button>
      {expanded && (
        <div className="mt-1.5 rounded-md border bg-background/60 px-3 py-2">
          <ThoughtChainSteps calls={calls} dataTestidPrefix={dataTestidPrefix} />
        </div>
      )}
    </div>
  );
}

type ChatSummary = {
  id: string;
  title: string;
  systemMessage: string;
  model?: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

type ChatDetail = {
  id: string;
  title: string;
  systemMessage: string;
  model?: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

type OllamaModel = { name: string; parameterSize: string | null };

// Per-attachment upload limits — keep modest so the conversation/payload doesn't blow up.
const ALLOWED_ATTACHMENT_EXTENSIONS = [".txt", ".json", ".csv", ".md"] as const;
const ALLOWED_ATTACHMENT_ACCEPT = ".txt,.json,.csv,.md,text/plain,application/json,text/csv,text/markdown";
const MAX_ATTACHMENT_BYTES = 256 * 1024; // 256 KB

function isAllowedAttachment(file: File): boolean {
  const lower = file.name.toLowerCase();
  return ALLOWED_ATTACHMENT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function attachmentTypeFor(file: File): string {
  if (file.type) return file.type;
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".md")) return "text/markdown";
  return "text/plain";
}

export default function AiChatDemoPage() {
  const { toast } = useToast();
  const [match, params] = useRoute("/ai-chat-demo/:id");
  const [, setLocation] = useLocation();
  const activeChatId = match ? params?.id : null;

  const selectChat = (id: string | null) => {
    if (id) {
      setLocation(`/ai-chat-demo/${id}`);
    } else {
      setLocation("/ai-chat-demo");
    }
  };

  // Backwards compatibility / deep-link query parameter support
  useEffect(() => {
    if (!match) {
      const qParams = new URLSearchParams(window.location.search);
      const qChatId = qParams.get("chatId");
      if (qChatId) {
        setLocation(`/ai-chat-demo/${qChatId}`, { replace: true });
      }
    }
  }, [match, setLocation]);
  const [input, setInput] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("message") ?? "";
  });
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemMessageDraft, setSystemMessageDraft] = useState("");
  const [modelDraft, setModelDraft] = useState<string>("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<{
    content: string;
    attachments: ChatAttachment[];
  } | null>(null);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchModel, setBranchModel] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingUserMessage, setStreamingUserMessage] = useState<ChatMessage | null>(null);
  // Word-by-word smoothing: drains the raw stream one token at a time into displayedContent.
  const [displayedContent, setDisplayedContent] = useState("");
  const wordQueueRef = useRef<string[]>([]);
  const drainIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isStreamingRef = useRef(false);
  const lastQueuedLenRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const autoSentRef = useRef(false);

  const { data: chats = [], isLoading: isLoadingChats } = useQuery<ChatSummary[]>({
    queryKey: ["/api/ai-chats"],
  });

  const { data: activeChat } = useQuery<ChatDetail>({
    queryKey: ["/api/ai-chats", activeChatId],
    enabled: !!activeChatId,
  });

  // Fetch the list of available Ollama models to power the per-chat model selector.
  const { data: modelsData } = useQuery<{ models: OllamaModel[] }>({
    queryKey: ["/api/ollama/models"],
    retry: false,
  });
  const availableModels = modelsData?.models ?? [];

  // Keep dialog drafts in sync with whichever chat is open.
  useEffect(() => {
    setSystemMessageDraft(activeChat?.systemMessage ?? "");
    setModelDraft(activeChat?.model ?? "");
  }, [activeChat?.id, activeChat?.systemMessage, activeChat?.model]);

  // Auto-scroll to the bottom when messages change.
  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat?.messages?.length, activeChatId]);

  // Start the word-drain interval when streaming begins; let it self-terminate when
  // the queue empties after streaming ends. Clean up on unmount.
  useEffect(() => {
    isStreamingRef.current = isStreaming;
    if (isStreaming) {
      if (drainIntervalRef.current) clearInterval(drainIntervalRef.current);
      wordQueueRef.current = [];
      lastQueuedLenRef.current = 0;
      setDisplayedContent("");
      drainIntervalRef.current = setInterval(() => {
        const word = wordQueueRef.current.shift();
        if (word !== undefined) {
          setDisplayedContent((prev) => prev + word);
        } else if (!isStreamingRef.current) {
          clearInterval(drainIntervalRef.current!);
          drainIntervalRef.current = null;
        }
      }, 200);
    }
  }, [isStreaming]);

  // Unmount cleanup only — don't clear on isStreaming change so the queue can finish draining.
  useEffect(() => {
    return () => {
      if (drainIntervalRef.current) clearInterval(drainIntervalRef.current);
    };
  }, []);

  // When new raw content arrives from the stream, split into tokens and enqueue them.
  useEffect(() => {
    const newText = streamingContent.slice(lastQueuedLenRef.current);
    if (!newText) return;
    lastQueuedLenRef.current = streamingContent.length;
    const tokens = newText.split(/(\s+)/).filter((t) => t.length > 0);
    wordQueueRef.current.push(...tokens);
  }, [streamingContent]);

  // While streaming, keep scrolling to bottom as displayed content grows.
  useEffect(() => {
    if (isStreaming) {
      scrollEndRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [displayedContent, isStreaming]);

  const createChatMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai-chats", {});
      return res.json() as Promise<ChatDetail>;
    },
    onSuccess: (chat) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-chats"] });
      selectChat(chat.id);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create chat", description: error.message, variant: "destructive" });
    },
  });

  // Live tool-call traces emitted by the server during the in-progress assistant
  // turn. Drives the icon-box row above the "Thinking" indicator.
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCallTrace[]>([]);

  // Pending write-tool approval requests, populated when the server emits a
  // `tool_approval_request` event (auth execution mode). The UI shows the
  // first one as a popup; subsequent requests queue behind it.
  const [pendingApprovals, setPendingApprovals] = useState<ToolApprovalRequest[]>([]);

  /** Send the user's accept/reject decision for a pending approval to the server. */
  const respondToApproval = async (id: string, decision: "accept" | "reject") => {
    setPendingApprovals((prev) => prev.filter((p) => p.id !== id));
    try {
      await apiRequest("POST", `/api/ai-tools/approvals/${id}`, { decision });
    } catch (err: any) {
      toast({ title: "Failed to send decision", description: err.message, variant: "destructive" });
    }
  };

  // Core streaming helper: reads NDJSON from a /stream endpoint, appends tokens to
  // streamingContent state, and on the final sentinel line updates the query cache.
  const runStream = async (chatId: string, url: string, payload: { message: string; attachments: ChatAttachment[] }) => {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok || !resp.body) {
      const errText = await resp.text().catch(() => "");
      let errMsg = `Request failed (${resp.status})`;
      try { errMsg = JSON.parse(errText).error ?? errMsg; } catch { /* use default */ }
      throw new Error(errMsg);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const raw = decoder.decode(value, { stream: true });
        buf += raw;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let parsed: any;
          try { parsed = JSON.parse(line); } catch { continue; }
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.event === "tool_call") {
            setStreamingToolCalls((prev) => [
              ...prev,
              {
                id: parsed.id,
                name: parsed.name ?? "",
                icon: parsed.icon ?? "search",
                label: parsed.label ?? parsed.name ?? "Tool",
                args: parsed.args ?? {},
                summary: "",
                ok: true,
                pending: true,
              },
            ]);
            continue;
          }
          if (parsed.event === "tool_approval_request") {
            // Server is awaiting the user's decision before running this tool.
            setPendingApprovals((prev) => [
              ...prev,
              {
                id: parsed.id,
                name: parsed.name ?? "",
                label: parsed.label ?? parsed.name ?? "Tool",
                icon: parsed.icon ?? "search",
                args: parsed.args ?? {},
              },
            ]);
            continue;
          }
          if (parsed.event === "tool_approval_decision") {
            // Already handled optimistically when the user clicked; just
            // make sure the popup is gone.
            setPendingApprovals((prev) => prev.filter((p) => p.id !== parsed.id));
            continue;
          }
          if (parsed.event === "tool_result") {
            setStreamingToolCalls((prev) =>
              prev.map((t) =>
                t.id === parsed.id ? { ...t, pending: false, ok: !!parsed.ok, summary: parsed.summary ?? "" } : t,
              ),
            );
            continue;
          }
          if (parsed.done && parsed.chat) {
            queryClient.setQueryData(["/api/ai-chats", chatId], parsed.chat);
            queryClient.invalidateQueries({ queryKey: ["/api/ai-chats"] });
          } else if (parsed.message?.content) {
            setStreamingContent((prev) => prev + parsed.message.content);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  };

  const streamSend = async (payload: { message: string; attachments: ChatAttachment[] }) => {
    setIsStreaming(true);
    setStreamingContent("");
    setStreamingToolCalls([]);
    setPendingApprovals([]);
    setStreamingUserMessage({ role: "user", content: payload.message, attachments: payload.attachments });
    try {
      let chatId = activeChatId;
      if (!chatId) {
        const created = await apiRequest("POST", "/api/ai-chats", {}).then((r) => r.json() as Promise<ChatDetail>);
        chatId = created.id;
        selectChat(chatId);
        queryClient.invalidateQueries({ queryKey: ["/api/ai-chats"] });
      }
      await runStream(chatId, `/api/ai-chats/${chatId}/message/stream`, payload);
    } catch (err: any) {
      toast({ title: "Message failed", description: err.message, variant: "destructive" });
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
      setStreamingToolCalls([]);
      setPendingApprovals([]);
      setStreamingUserMessage(null);
    }
  };

  // Auto-send the message from the URL ?message= query parameter on initial load.
  useEffect(() => {
    if (autoSentRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const messageParam = params.get("message");
    if (messageParam && messageParam.trim()) {
      autoSentRef.current = true;
      // Remove the message param from the URL so refreshing doesn't re-send.
      params.delete("message");
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params.toString()}`
        : window.location.pathname;
      window.history.replaceState({}, "", newUrl);
      setInput("");
      void streamSend({ message: messageParam.trim(), attachments: [] });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const streamRegenerate = async (payload: { message: string; attachments: ChatAttachment[] }) => {
    if (!activeChatId) return;

    // Optimistically trim the history to match what the server will do, so the UI
    // shows the correct context (without the old user+assistant tail) during streaming.
    const currentChat = queryClient.getQueryData(["/api/ai-chats", activeChatId]) as ChatDetail | undefined;
    let trimmed: ChatMessage[] = [...(currentChat?.messages ?? [])];
    if (trimmed.length > 0 && trimmed[trimmed.length - 1].role === "assistant") trimmed.pop();
    const lastUserIdx = (() => {
      for (let i = trimmed.length - 1; i >= 0; i--) if (trimmed[i].role === "user") return i;
      return -1;
    })();
    if (lastUserIdx === -1) {
      toast({ title: "No previous message to edit.", variant: "destructive" });
      return;
    }
    trimmed = trimmed.slice(0, lastUserIdx);

    // Update cache to the trimmed history; the new user message is shown via streamingUserMessage.
    queryClient.setQueryData(["/api/ai-chats", activeChatId], (old: ChatDetail | undefined) =>
      old ? { ...old, messages: trimmed } : old
    );

    setIsStreaming(true);
    setStreamingContent("");
    setStreamingToolCalls([]);
    setPendingApprovals([]);
    setStreamingUserMessage({ role: "user", content: payload.message, attachments: payload.attachments });
    try {
      await runStream(activeChatId, `/api/ai-chats/${activeChatId}/regenerate/stream`, payload);
      setEditingPrompt(null);
    } catch (err: any) {
      // Revert the optimistic trim on error so the user doesn't lose their history.
      if (currentChat) queryClient.setQueryData(["/api/ai-chats", activeChatId], currentChat);
      toast({ title: "Failed to update prompt", description: err.message, variant: "destructive" });
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
      setStreamingToolCalls([]);
      setPendingApprovals([]);
      setStreamingUserMessage(null);
    }
  };

  const saveSettingsMutation = useMutation({
    mutationFn: async (patch: { systemMessage: string; model: string }) => {
      if (!activeChatId) return null;
      const res = await apiRequest("PATCH", `/api/ai-chats/${activeChatId}`, patch);
      return res.json() as Promise<ChatDetail>;
    },
    onSuccess: (chat) => {
      if (chat) {
        queryClient.setQueryData(["/api/ai-chats", chat.id], chat);
        queryClient.invalidateQueries({ queryKey: ["/api/ai-chats"] });
      }
      setSettingsOpen(false);
      toast({ title: "Settings saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save settings", description: error.message, variant: "destructive" });
    },
  });

  const branchMutation = useMutation({
    mutationFn: async (model: string) => {
      if (!activeChatId) throw new Error("No active chat");
      const res = await apiRequest("POST", `/api/ai-chats/${activeChatId}/branch`, { model });
      return res.json() as Promise<ChatDetail>;
    },
    onSuccess: (chat) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-chats"] });
      queryClient.setQueryData(["/api/ai-chats", chat.id], chat);
      selectChat(chat.id);
      setBranchOpen(false);
      toast({ title: "Conversation branched", description: `New chat: ${chat.title}` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to branch chat", description: error.message, variant: "destructive" });
    },
  });

  const deleteChatMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/ai-chats/${id}`);
      return id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-chats"] });
      if (activeChatId === id) selectChat(null);
      setPendingDeleteId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete chat", description: error.message, variant: "destructive" });
      setPendingDeleteId(null);
    },
  });

  // Reads selected files as text and adds them to the given attachment list setter.
  const handleFilesSelected = async (
    files: FileList | null,
    setter: (next: ChatAttachment[]) => void,
    current: ChatAttachment[],
  ) => {
    if (!files || files.length === 0) return;
    const next: ChatAttachment[] = [...current];
    for (const file of Array.from(files)) {
      if (!isAllowedAttachment(file)) {
        toast({
          title: "Unsupported file",
          description: `${file.name} is not a supported text file (.txt, .json, .csv, .md).`,
          variant: "destructive",
        });
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast({
          title: "File too large",
          description: `${file.name} exceeds the ${Math.round(MAX_ATTACHMENT_BYTES / 1024)} KB limit.`,
          variant: "destructive",
        });
        continue;
      }
      try {
        const text = await file.text();
        next.push({ name: file.name, type: attachmentTypeFor(file), content: text });
      } catch (err: any) {
        toast({ title: "Failed to read file", description: err?.message ?? String(err), variant: "destructive" });
      }
    }
    setter(next);
  };

  const handleSend = () => {
    const message = input.trim();
    if ((!message && pendingAttachments.length === 0) || isStreaming) return;
    const payload = { message, attachments: pendingAttachments };
    setInput("");
    setPendingAttachments([]);
    void streamSend(payload);
  };

  const handleStartEditLastPrompt = () => {
    const msgs = activeChat?.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user") {
        setEditingPrompt({
          content: msgs[i].content,
          attachments: msgs[i].attachments ? [...msgs[i].attachments!] : [],
        });
        return;
      }
    }
  };

  const handleSubmitEditedPrompt = () => {
    if (!editingPrompt) return;
    const message = editingPrompt.content.trim();
    if (!message && editingPrompt.attachments.length === 0) return;
    void streamRegenerate({ message, attachments: editingPrompt.attachments });
  };

  const messages = activeChat?.messages ?? [];
  const isSending = isStreaming;
  const isRegenerating = isStreaming;

  // Find index of the most recent user message so we can attach an inline edit affordance.
  const lastUserIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return i;
    return -1;
  })();

  // Show the optimistic user message during streaming (both send and regenerate cases).
  const displayMessages: ChatMessage[] =
    isStreaming && streamingUserMessage
      ? [...messages, streamingUserMessage]
      : messages;

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Tool-call approval popup. Shows the first pending request; later
          requests queue behind it. */}
      <ToolApprovalPopup
        request={pendingApprovals[0] ?? null}
        onDecision={respondToApproval}
      />
      {/* Sidebar with historical chats */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r bg-sidebar" data-testid="chat-history-sidebar">
        <div className="p-3 border-b">
          <Button
            className="w-full justify-start gap-2"
            onClick={() => createChatMutation.mutate()}
            disabled={createChatMutation.isPending}
            data-testid="button-new-chat"
          >
            <Plus className="h-4 w-4" />
            New chat
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {isLoadingChats ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : chats.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-4 text-center">
                No conversations yet. Start a new chat.
              </p>
            ) : (
              chats.map((chat) => (
                <div
                  key={chat.id}
                  className={cn(
                    "group flex items-center gap-1 rounded-md px-2 py-2 text-sm cursor-pointer hover-elevate",
                    activeChatId === chat.id && "bg-sidebar-accent",
                  )}
                  onClick={() => selectChat(chat.id)}
                  data-testid={`chat-history-item-${chat.id}`}
                >
                  <MessagesSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{chat.title}</span>
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDeleteId(chat.id);
                    }}
                    data-testid={`button-delete-chat-${chat.id}`}
                    aria-label="Delete chat"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </aside>

      {/* Main conversation */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
          <h1 className="text-sm font-semibold flex items-center gap-2 truncate" data-testid="text-ai-chat-title">
            <Bot className="h-4 w-4" />
            {activeChat?.title ?? "AI Chat - Demo"}
            {activeChat?.model ? (
              <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground" data-testid="text-active-model">
                {activeChat.model}
              </span>
            ) : null}
          </h1>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => createChatMutation.mutate()}
              disabled={createChatMutation.isPending}
              title="New chat"
              data-testid="button-new-chat-mobile"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (!activeChatId) {
                  toast({ title: "No active chat", description: "Open a chat to branch off." });
                  return;
                }
                setBranchModel(activeChat?.model ?? "");
                setBranchOpen(true);
              }}
              disabled={!activeChatId}
              title="Branch off conversation with a new model"
              data-testid="button-branch-chat"
            >
              <GitBranch className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSettingsOpen(true)}
              title="Chat settings"
              data-testid="button-chat-settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 space-y-6">
            {displayMessages.length === 0 && !isSending ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
                <Bot className="h-10 w-10" />
                <p className="text-sm">Send a message to start the conversation.</p>
              </div>
            ) : (
              displayMessages.map((m, i) => (
                <div
                  key={i}
                  className={cn("flex gap-3", m.role === "user" ? "justify-end" : "justify-start")}
                  data-testid={`message-${m.role}-${i}`}
                >
                  {m.role === "assistant" && (
                    <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Bot className="h-4 w-4" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "rounded-lg px-4 py-2 max-w-[80%] relative group",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted",
                    )}
                  >
                    {m.role === "assistant" ? (
                      <>
                        {m.toolCalls && m.toolCalls.length > 0 && (
                          <ThoughtChain calls={m.toolCalls} dataTestidPrefix={`message-${i}`} />
                        )}
                        <MarkdownMessage content={m.content} />
                        {m.links && m.links.length > 0 && (
                          <div className="mt-3 pt-2 border-t border-muted-foreground/10 flex flex-wrap gap-2" data-testid={`message-links-${i}`}>
                            {m.links.map((link, linkIdx) => (
                              <Link key={linkIdx} to={link.url}>
                                <a className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-medium transition-colors border shadow-sm cursor-pointer">
                                  <Link2 className="h-3 w-3 text-indigo-500" />
                                  {link.title}
                                </a>
                              </Link>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {m.content && (
                          <p className="whitespace-pre-wrap break-words text-sm">{m.content}</p>
                        )}
                        {m.attachments && m.attachments.length > 0 && (
                          <div className={cn("mt-2 flex flex-wrap gap-1", !m.content && "mt-0")}>
                            {m.attachments.map((a, ai) => (
                              <span
                                key={ai}
                                className="inline-flex items-center gap-1 rounded-md bg-primary-foreground/20 px-2 py-0.5 text-[11px]"
                                data-testid={`attachment-chip-${i}-${ai}`}
                                title={`${a.name} (${a.type})`}
                              >
                                <FileText className="h-3 w-3" />
                                <span className="max-w-[160px] truncate">{a.name}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    {m.role === "user" && i === lastUserIndex && !isSending && !isRegenerating && (
                      <button
                        type="button"
                        onClick={handleStartEditLastPrompt}
                        className="absolute -left-9 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground transition-opacity"
                        title="Edit and resend prompt"
                        data-testid={`button-edit-prompt-${i}`}
                        aria-label="Edit prompt"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {m.role === "user" && (
                    <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                      <UserIcon className="h-4 w-4" />
                    </div>
                  )}
                </div>
              ))
            )}
            {isStreaming && (
              <div className="flex gap-3 justify-start" data-testid="message-assistant-streaming">
                <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="rounded-lg bg-muted px-4 py-2 max-w-[80%]">
                  {streamingToolCalls.length > 0 && (
                    <ThoughtChain calls={streamingToolCalls} live dataTestidPrefix="streaming" />
                  )}
                  {streamingContent ? (
                    <MarkdownMessage content={displayedContent} />
                  ) : (
                    <div className="py-1">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
              </div>
            )}
            <div ref={scrollEndRef} />
          </div>
        </ScrollArea>

        <div className="border-t p-3">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
            {pendingAttachments.length > 0 && (
              <div className="flex flex-wrap gap-1" data-testid="pending-attachments">
                {pendingAttachments.map((a, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
                  >
                    <FileText className="h-3 w-3" />
                    <span className="max-w-[200px] truncate">{a.name}</span>
                    <button
                      type="button"
                      onClick={() => setPendingAttachments((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove attachment"
                      data-testid={`button-remove-attachment-${idx}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ALLOWED_ATTACHMENT_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  void handleFilesSelected(e.target.files, setPendingAttachments, pendingAttachments);
                  // Reset so the same file can be picked again later if removed.
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                data-testid="input-file-attachment"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSending}
                title="Attach text file (.txt, .json, .csv, .md)"
                data-testid="button-attach-file"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Type a message…  (Enter to send, Shift+Enter for newline)"
                rows={1}
                className="min-h-[2.5rem] max-h-40 resize-none"
                data-testid="input-chat-message"
              />
              <Button
                onClick={handleSend}
                disabled={(!input.trim() && pendingAttachments.length === 0) || isSending}
                size="icon"
                data-testid="button-send-message"
              >
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Settings modal */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent data-testid="dialog-chat-settings">
          <DialogHeader>
            <DialogTitle>Chat Settings</DialogTitle>
            <DialogDescription>
              Configure how the AI behaves in this conversation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="chat-model">Model</Label>
              <Select
                value={modelDraft || "__default__"}
                onValueChange={(v) => setModelDraft(v === "__default__" ? "" : v)}
                disabled={!activeChatId}
              >
                <SelectTrigger id="chat-model" data-testid="select-chat-model">
                  <SelectValue placeholder="Use default text model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__" data-testid="option-chat-model-default">
                    Use default text model
                  </SelectItem>
                  {availableModels.map((m) => (
                    <SelectItem key={m.name} value={m.name} data-testid={`option-chat-model-${m.name}`}>
                      {m.name}
                      {m.parameterSize ? ` (${m.parameterSize})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Pick the Ollama model used when sending new messages in this chat.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="system-message">System message</Label>
              <Textarea
                id="system-message"
                value={systemMessageDraft}
                onChange={(e) => setSystemMessageDraft(e.target.value)}
                placeholder="e.g. You are a helpful assistant."
                rows={5}
                className="resize-y"
                disabled={!activeChatId}
                data-testid="textarea-system-message"
              />
              <p className="text-xs text-muted-foreground">
                {activeChatId
                  ? "The system message guides the assistant's behavior for this chat."
                  : "Start or open a chat to configure its system message."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)} data-testid="button-cancel-settings">
              Cancel
            </Button>
            <Button
              onClick={() => saveSettingsMutation.mutate({ systemMessage: systemMessageDraft, model: modelDraft })}
              disabled={!activeChatId || saveSettingsMutation.isPending}
              data-testid="button-save-settings"
            >
              {saveSettingsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Branch off modal */}
      <Dialog open={branchOpen} onOpenChange={setBranchOpen}>
        <DialogContent data-testid="dialog-branch-chat">
          <DialogHeader>
            <DialogTitle>Branch off conversation</DialogTitle>
            <DialogDescription>
              Duplicates the current conversation into a new chat so you can continue with a different model
              without losing the original thread.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="branch-model">Model for the new chat</Label>
            <Select
              value={branchModel || "__default__"}
              onValueChange={(v) => setBranchModel(v === "__default__" ? "" : v)}
            >
              <SelectTrigger id="branch-model" data-testid="select-branch-model">
                <SelectValue placeholder="Use default text model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__" data-testid="option-branch-model-default">
                  Use default text model
                </SelectItem>
                {availableModels.map((m) => (
                  <SelectItem key={m.name} value={m.name} data-testid={`option-branch-model-${m.name}`}>
                    {m.name}
                    {m.parameterSize ? ` (${m.parameterSize})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBranchOpen(false)} data-testid="button-cancel-branch">
              Cancel
            </Button>
            <Button
              onClick={() => branchMutation.mutate(branchModel)}
              disabled={branchMutation.isPending}
              data-testid="button-confirm-branch"
            >
              {branchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Branch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit last-prompt modal */}
      <Dialog open={!!editingPrompt} onOpenChange={(open) => !open && setEditingPrompt(null)}>
        <DialogContent data-testid="dialog-edit-prompt">
          <DialogHeader>
            <DialogTitle>Edit prompt</DialogTitle>
            <DialogDescription>
              Update your most recent message and resend it. The previous reply will be replaced.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Textarea
              value={editingPrompt?.content ?? ""}
              onChange={(e) =>
                setEditingPrompt((prev) => (prev ? { ...prev, content: e.target.value } : prev))
              }
              rows={6}
              className="resize-y"
              data-testid="textarea-edit-prompt"
            />
            {editingPrompt && editingPrompt.attachments.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {editingPrompt.attachments.map((a, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
                  >
                    <FileText className="h-3 w-3" />
                    <span className="max-w-[200px] truncate">{a.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingPrompt((prev) =>
                          prev ? { ...prev, attachments: prev.attachments.filter((_, i) => i !== idx) } : prev,
                        )
                      }
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove attachment"
                      data-testid={`button-remove-edit-attachment-${idx}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div>
              <input
                ref={editFileInputRef}
                type="file"
                multiple
                accept={ALLOWED_ATTACHMENT_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  if (!editingPrompt) return;
                  void handleFilesSelected(
                    e.target.files,
                    (next) =>
                      setEditingPrompt((prev) => (prev ? { ...prev, attachments: next } : prev)),
                    editingPrompt.attachments,
                  );
                  if (editFileInputRef.current) editFileInputRef.current.value = "";
                }}
                data-testid="input-edit-file-attachment"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => editFileInputRef.current?.click()}
                data-testid="button-edit-attach-file"
              >
                <Paperclip className="mr-2 h-3.5 w-3.5" />
                Attach file
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPrompt(null)} data-testid="button-cancel-edit-prompt">
              Cancel
            </Button>
            <Button
              onClick={handleSubmitEditedPrompt}
              disabled={
                isRegenerating ||
                !editingPrompt ||
                (!editingPrompt.content.trim() && editingPrompt.attachments.length === 0)
              }
              data-testid="button-submit-edit-prompt"
            >
              {isRegenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Resend"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent data-testid="dialog-delete-chat">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This conversation and its history will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingDeleteId && deleteChatMutation.mutate(pendingDeleteId)}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
