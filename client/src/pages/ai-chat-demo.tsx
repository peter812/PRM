import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
} from "lucide-react";

type ChatAttachment = {
  name: string;
  type: string;
  content: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
};

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
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [input, setInput] = useState("");
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);

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

  const createChatMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai-chats", {});
      return res.json() as Promise<ChatDetail>;
    },
    onSuccess: (chat) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-chats"] });
      setActiveChatId(chat.id);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create chat", description: error.message, variant: "destructive" });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (payload: { message: string; attachments: ChatAttachment[] }) => {
      let chatId = activeChatId;
      if (!chatId) {
        const created = await apiRequest("POST", "/api/ai-chats", {}).then((r) => r.json() as Promise<ChatDetail>);
        chatId = created.id;
        setActiveChatId(chatId);
      }
      const res = await apiRequest("POST", `/api/ai-chats/${chatId}/message`, payload);
      return res.json() as Promise<{ chat: ChatDetail; assistant: ChatMessage }>;
    },
    onSuccess: ({ chat }) => {
      queryClient.setQueryData(["/api/ai-chats", chat.id], chat);
      queryClient.invalidateQueries({ queryKey: ["/api/ai-chats"] });
    },
    onError: (error: Error) => {
      toast({ title: "Message failed", description: error.message, variant: "destructive" });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async (payload: { message: string; attachments: ChatAttachment[] }) => {
      if (!activeChatId) throw new Error("No active chat");
      const res = await apiRequest("POST", `/api/ai-chats/${activeChatId}/regenerate`, payload);
      return res.json() as Promise<{ chat: ChatDetail; assistant: ChatMessage }>;
    },
    onSuccess: ({ chat }) => {
      queryClient.setQueryData(["/api/ai-chats", chat.id], chat);
      queryClient.invalidateQueries({ queryKey: ["/api/ai-chats"] });
      setEditingPrompt(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update prompt", description: error.message, variant: "destructive" });
    },
  });

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
      setActiveChatId(chat.id);
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
      if (activeChatId === id) setActiveChatId(null);
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
    if ((!message && pendingAttachments.length === 0) || sendMutation.isPending) return;
    const payload = { message, attachments: pendingAttachments };
    setInput("");
    setPendingAttachments([]);
    sendMutation.mutate(payload);
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
    regenerateMutation.mutate({ message, attachments: editingPrompt.attachments });
  };

  const messages = activeChat?.messages ?? [];
  const isSending = sendMutation.isPending;
  const isRegenerating = regenerateMutation.isPending;

  // Find index of the most recent user message so we can attach an inline edit affordance.
  const lastUserIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return i;
    return -1;
  })();

  // Optimistically show the in-flight user message while awaiting the reply.
  const displayMessages: ChatMessage[] =
    isSending && sendMutation.variables
      ? [...messages, { role: "user", content: sendMutation.variables.message, attachments: sendMutation.variables.attachments }]
      : messages;

  return (
    <div className="flex h-full w-full overflow-hidden">
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
                  onClick={() => setActiveChatId(chat.id)}
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
                      <MarkdownMessage content={m.content} />
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
            {(isSending || isRegenerating) && (
              <div className="flex gap-3 justify-start" data-testid="message-assistant-loading">
                <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="rounded-lg bg-muted px-4 py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
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
                regenerateMutation.isPending ||
                !editingPrompt ||
                (!editingPrompt.content.trim() && editingPrompt.attachments.length === 0)
              }
              data-testid="button-submit-edit-prompt"
            >
              {regenerateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Resend"}
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
