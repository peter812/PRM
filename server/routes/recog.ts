/**
 * PRM-VR recog mode: who is this face? See C:\Repos\PRM\Guides\recog-mode-plan.md.
 *
 * Option A posts aligned 112x112 crops (multipart `crops`), Option B posts the
 * embeddings the headset computed itself (JSON { embeddings }). Crops are one-use:
 * multer keeps them in memory only, they go to compute's ephemeral embed-aligned
 * endpoint and are dropped with the request — nothing is written to disk, S3 or the DB.
 */
import type { Express } from "express";
import multer from "multer";
import { z } from "zod";
import { computeFetch } from "../recognition";
import { AUTO_ASSIGN_MIN_MARGIN, getAutoAssignMinScore, getVerifyMinScore, lookAlikesForEmbeddings } from "../face-lookalikes";
import { buildIdentityCache } from "../face-review";
import { sendReferenceError } from "./references";

const MAX_FACES = 16;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 256 * 1024, files: MAX_FACES } });
const embeddingsSchema = z.object({ embeddings: z.array(z.array(z.number()).length(512)).min(1).max(MAX_FACES) });

async function embedCrops(crops: Express.Multer.File[]): Promise<number[][]> {
  const form = new FormData();
  for (const crop of crops) form.append("images", new Blob([crop.buffer], { type: "image/jpeg" }), "face.jpg");
  const response = await computeFetch("/api/face/embed-aligned", form, 10_000);
  if (!response.ok) throw new Error(`PRM-Compute error: ${await response.text()}`);
  return (await response.json()).embeddings;
}

export function registerRoutes(app: Express) {
  app.post("/api/vr/recognize", upload.array("crops", MAX_FACES), async (req, res) => {
    try {
      const crops = (req.files as Express.Multer.File[] | undefined) ?? [];
      const embeddings = crops.length ? await embedCrops(crops) : embeddingsSchema.parse(req.body).embeddings;
      const [verifyMin, sureMin] = await Promise.all([getVerifyMinScore(), getAutoAssignMinScore()]);
      const lookAlikes = await lookAlikesForEmbeddings(embeddings, verifyMin);
      const identities = await buildIdentityCache(Array.from(new Set(lookAlikes.flatMap((l) => l.map((m) => m.personfaceUuid)))));

      res.json({
        faces: lookAlikes.map(([best, runnerUp]) => {
          const identity = best && identities.get(best.personfaceUuid);
          if (!identity) return { match: null };
          const sure = best.score >= sureMin && best.score - (runnerUp?.score ?? 0) >= AUTO_ASSIGN_MIN_MARGIN;
          return { match: { ...identity, personfaceUuid: best.personfaceUuid, score: best.score, sure } };
        }),
      });
    } catch (error) {
      sendReferenceError(res, error, "Failed to recognize faces");
    }
  });
}
