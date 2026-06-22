import { db } from "./server/db";
import { appSettings } from "./shared/schema";
import { eq } from "drizzle-orm";

async function getOllamaSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return row ? row.value : null;
}

async function run() {
  try {
    const apiUrl = (await getOllamaSetting("ollama_api_url")) ?? "";
    if (!apiUrl) {
      console.error("Ollama API URL not configured.");
      process.exit(1);
    }
    const base = apiUrl.replace(/\/+$/, "");
    const response = await fetch(`${base}/api/tags`);
    if (!response.ok) {
      console.error("Failed to list models:", response.status);
      process.exit(1);
    }
    const data = await response.json();
    console.log("Installed Ollama Models:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error:", err);
  } finally {
    process.exit(0);
  }
}

run();
