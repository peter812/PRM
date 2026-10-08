import type { Response } from "express";

export type SSEEventType =
  | "social_account.updated"
  | "social_account.created"
  | "scrape.completed"
  | "task.updated"
  | "image_task.updated"
  | "tracking_job.updated"
  | "worker.status";

interface SSEClient {
  id: string;
  res: Response;
}

class SSEManager {
  private clients: SSEClient[] = [];

  addClient(id: string, res: Response): void {
    this.clients.push({ id, res });
  }

  removeClient(id: string): void {
    this.clients = this.clients.filter((c) => c.id !== id);
  }

  /**
   * Broadcast an event to all connected SSE clients.
   */
  broadcast(event: SSEEventType, data: Record<string, any>): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.res.write(payload);
      } catch {
        // Client may have disconnected; remove on next cleanup
      }
    }
  }

  getClientCount(): number {
    return this.clients.length;
  }
}

export const sseManager = new SSEManager();
