import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
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
} from "lucide-react";

type ChatMessage = { role: "user" | "assistant"; content: string };

type ChatSummary = {
  id: string;
  title: string;
  systemMessage: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

type ChatDetail = {
  id: string;
  title: string;
  systemMessage: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

export default function AiChatDemoPage() {
  const { toast } = useToast();
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemMessageDraft, setSystemMessageDraft] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  const { data: chats = [], isLoading: isLoadingChats } = useQuery<ChatSummary[]>({
    queryKey: ["/api/ai-chats"],
  });

  const { data: activeChat } = useQuery<ChatDetail>({
    queryKey: ["/api/ai-chats", activeChatId],
    enabled: !!activeChatId,
  });

  // Keep the system-message draft in sync with whichever chat is open.
  useEffect(() => {
    setSystemMessageDraft(activeChat?.systemMessage ?? "");
  }, [activeChat?.id, activeChat?.systemMessage]);

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
    mutationFn: async (message: string) => {
      let chatId = activeChatId;
      if (!chatId) {
        const created = await apiRequest("POST", "/api/ai-chats", {}).then((r) => r.json() as Promise<ChatDetail>);
        chatId = created.id;
        setActiveChatId(chatId);
      }
      const res = await apiRequest("POST", `/api/ai-chats/${chatId}/message`, { message });
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

  const saveSettingsMutation = useMutation({
    mutationFn: async (systemMessage: string) => {
      if (!activeChatId) return null;
      const res = await apiRequest("PATCH", `/api/ai-chats/${activeChatId}`, { systemMessage });
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

  const handleSend = () => {
    const message = input.trim();
    if (!message || sendMutation.isPending) return;
    setInput("");
    sendMutation.mutate(message);
  };

  const messages = activeChat?.messages ?? [];
  const isSending = sendMutation.isPending;

  // Optimistically show the in-flight user message while awaiting the reply.
  const displayMessages: ChatMessage[] =
    isSending && sendMutation.variables
      ? [...messages, { role: "user", content: sendMutation.variables }]
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
                      "rounded-lg px-4 py-2 max-w-[80%]",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted",
                    )}
                  >
                    {m.role === "assistant" ? (
                      <MarkdownMessage content={m.content} />
                    ) : (
                      <p className="whitespace-pre-wrap break-words text-sm">{m.content}</p>
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
            {isSending && (
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
          <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
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
              disabled={!input.trim() || isSending}
              size="icon"
              data-testid="button-send-message"
            >
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
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
          <div className="space-y-2 py-2">
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)} data-testid="button-cancel-settings">
              Cancel
            </Button>
            <Button
              onClick={() => saveSettingsMutation.mutate(systemMessageDraft)}
              disabled={!activeChatId || saveSettingsMutation.isPending}
              data-testid="button-save-settings"
            >
              {saveSettingsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
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
