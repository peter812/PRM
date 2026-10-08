import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "../db";
import { people, photos } from "@shared/schema";
import { storage } from "../storage";
import { fetchImageBuffer } from "../prm-s3";
import { syncEntityInBackground } from "../vector-universal";
import { chat, resolveModel } from "./provider";

const DEFAULT_VISION_PROMPT = "Return 2 sentences explaining what is happening in this image.";

/** Provider errors that mean the image itself was too big. */
const IMAGE_TOO_LARGE = /returned 413|too (large|big)|exceed|max(imum)?[^.]{0,40}(size|pixels|dimension)/i;
const RETRY_MAX_SIDE = 2048;

/** Downscaled copy for providers that reject the original. */
function shrinkImage(image: Buffer): Promise<Buffer> {
  return sharp(image).rotate()
    .resize(RETRY_MAX_SIDE, RETRY_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** Run the vision model on one or more images. `override` picks a specific provider/model instead of the vision setting. */
export async function describeImage(
  image: Buffer | Buffer[],
  opts: { prompt?: string; system?: string; override?: { providerId?: string; model?: string }; think?: boolean } = {},
): Promise<string> {
  const resolved = await resolveModel("vision", opts.override);
  const prompt = opts.prompt || (await storage.getAppSetting("ai_vision_prompt")) || DEFAULT_VISION_PROMPT;
  const images = Array.isArray(image) ? image : [image];
  const send = async (imgs: Buffer[]) => (await chat(resolved, {
    messages: [
      ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
      { role: "user", content: prompt, images: imgs.map((img) => img.toString("base64")) },
    ],
    think: opts.think,
    signal: AbortSignal.timeout(120000),
  })).content;
  // Full quality first; scale down only when the provider rejects the size.
  try {
    return await send(images);
  } catch (err: any) {
    if (!IMAGE_TOO_LARGE.test(err?.message ?? "")) throw err;
    return send(await Promise.all(images.map(shrinkImage)));
  }
}



/** Describe a stored photo (with recognized faces as context) and save the description on it. */
export async function describePhoto(photoId: string): Promise<string> {
  const [photo] = await db.select().from(photos).where(eq(photos.id, photoId));
  if (!photo) throw new Error("Photo not found");

  const resolvedFaces: string[] = [];
  for (const face of (photo.facialIds as any[]) || []) {
    let name = "unknown person";
    if (face.personId) {
      const [person] = await db.select().from(people).where(eq(people.id, face.personId));
      if (person) name = `${person.firstName} ${person.lastName}`;
    }
    const coordStr = face.coordinates
      ? `at bounds [x:${face.coordinates.x}, y:${face.coordinates.y}, w:${face.coordinates.w}, h:${face.coordinates.h}]`
      : "";
    resolvedFaces.push(`Face ${coordStr}: ${name}`);
  }

  let prompt = (await storage.getAppSetting("ai_vision_prompt")) || DEFAULT_VISION_PROMPT;
  if (resolvedFaces.length > 0) {
    prompt += `\n\nFor context, the following people have been recognized in the image:\n${resolvedFaces.join("\n")}`;
  }

  const { buffer } = await fetchImageBuffer(photo.location);
  const description = await describeImage(buffer, { prompt });

  await db.update(photos)
    .set({ imageDescription: description, imageDescriptionAt: new Date() })
    .where(eq(photos.id, photoId));

  // The photo now has an AI description, so it's eligible for vector storage.
  if (description.trim()) syncEntityInBackground("image", photoId);

  return description;
}

// Upload auto-describes run one at a time so a batch of uploads doesn't hold
// many full-size images (and their base64 copies) in memory at once.
let backgroundQueue: Promise<unknown> = Promise.resolve();

export function describePhotoInBackground(photoId: string): Promise<string> {
  const run = backgroundQueue.then(() => describePhoto(photoId));
  backgroundQueue = run.catch(() => {});
  return run;
}
