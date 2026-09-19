import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    let url = "";
    if (typeof queryKey[0] === "string" && queryKey[0].startsWith("/")) {
      url = queryKey[0];
      if (queryKey.length > 1) {
        const segments: string[] = [];
        const params = new URLSearchParams();
        for (let i = 1; i < queryKey.length; i++) {
          const item = queryKey[i];
          if (item === null || item === undefined) continue;
          if (typeof item === "object") {
            for (const [k, v] of Object.entries(item as Record<string, any>)) {
              if (v !== undefined && v !== null) {
                params.set(k, String(v));
              }
            }
          } else {
            // Keys like ["/api/social-accounts", id, "posts?includeDeleted=true"]
            // carry raw path/query fragments — join verbatim, don't encode.
            segments.push(String(item));
          }
        }
        if (segments.length > 0) {
          url = `${url.replace(/\/$/, "")}/${segments.join("/")}`;
        }
        const qs = params.toString();
        if (qs) {
          url += (url.includes("?") ? "&" : "?") + qs;
        }
      }
    } else {
      url = queryKey.join("/");
    }

    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 2 * 60 * 1000, // 2 minutes: instant navigation cache with automatic freshness
      gcTime: 15 * 60 * 1000, // 15 minutes: preserve pagination and tabs during navigation
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
