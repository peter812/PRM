import type { Response } from "express";

export type SSEEventType =
  | "social_account.updated"
  | "social_account.created"
  | "scrape.completed"
  | "task.updated"
  | "image_task.updated"
  | "tracking_job.updated"
  | "story_run.updated"
  | "worker.status";

interface SSEClient {
  id: string;
  res: Response;
  userId?: string | number;
  backpressured?: boolean;
}

const MAX_CLIENTS_PER_USER = 10;
const MAX_TOTAL_CLIENTS = 200;

class SSEManager {
  private clients = new Map<string, SSEClient>();

  addClient(id: string, res: Response, userId?: string | number): void {
    if (userId !== undefined) {
      const userClients: SSEClient[] = [];
      for (const client of this.clients.values()) {
        if (client.userId === userId) {
          userClients.push(client);
        }
      }
      while (userClients.length >= MAX_CLIENTS_PER_USER) {
        const oldest = userClients.shift();
        if (!oldest) break;
        this.evictClient(oldest);
      }
    }

    while (this.clients.size >= MAX_TOTAL_CLIENTS) {
      const oldest = this.clients.values().next().value;
      if (!oldest) break;
      this.evictClient(oldest);
    }

    this.clients.set(id, { id, res, userId });
  }

  private evictClient(client: SSEClient): void {
    this.removeClient(client.id);
    try {
      if (!client.res.writableEnded) {
        client.res.end();
      }
    } catch {
      // Ignore errors closing an already-closed response
    }
  }

  removeClient(id: string): void {
    this.clients.delete(id);
  }

  /**
   * Broadcast an event to connected SSE clients, optionally scoped to a specific userId.
   */
  broadcast(event: SSEEventType, data: Record<string, any>, targetUserId?: string | number): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

    for (const [id, client] of this.clients) {
      if (targetUserId !== undefined && client.userId !== targetUserId) {
        continue;
      }
      if (client.res.writableEnded || client.res.destroyed) {
        this.clients.delete(id);
        continue;
      }
      if (client.backpressured) {
        continue;
      }
      try {
        const ok = client.res.write(payload);
        if (!ok) {
          client.backpressured = true;
          client.res.once("drain", () => {
            client.backpressured = false;
          });
        }
      } catch {
        this.clients.delete(id);
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

export const sseManager = new SSEManager();
