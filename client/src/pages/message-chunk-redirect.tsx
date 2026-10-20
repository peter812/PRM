import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Loader2 } from "lucide-react";

/** Resolves a message-chunk search hit to the chat page that shows it, then replaces itself with that page. */
export default function MessageChunkRedirect() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { data, error } = useQuery<{ href: string }>({ queryKey: [`/api/message-chunks/${id}`] });

  useEffect(() => {
    if (data?.href) navigate(data.href, { replace: true });
  }, [data?.href, navigate]);

  return (
    <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
      {error ? (error as Error).message : <><Loader2 className="h-4 w-4 animate-spin" /> Opening conversation…</>}
    </div>
  );
}
