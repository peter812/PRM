/**
 * Parser for "SMS Backup & Restore" (SyncTech) XML exports.
 *
 * Groups every <sms> and <mms> into threads keyed by the set of counterpart
 * numbers, so a 1:1 thread and a group MMS each become one conversation.
 * Attribute-regex parsing is deliberate: files reach hundreds of MB and are
 * flat, so a DOM is not worth its memory.
 */
import crypto from "crypto";
import fs from "fs";
import { cleanPhoneNumberForStorage } from "@shared/schema";
import { unescapeXml } from "./xml-utils";

export interface ParsedSmsMessage {
  externalId: string;
  sentAt: Date;
  /** Sent from the backup owner's phone */
  isOwner: boolean;
  /** Normalized counterpart number; null for owner messages */
  senderAddress: string | null;
  /** Null when the MMS carried only media */
  content: string | null;
  hasMedia: boolean;
}

export interface ParsedSmsThread {
  /** Sorted counterpart numbers joined by "," — stable identity across re-imports */
  key: string;
  addresses: string[];
  /** contact_name from the backup, when the phone had one */
  contactName: string | null;
  messages: ParsedSmsMessage[];
}

const ATTR_REGEX_CACHE = new Map<string, RegExp>();

/** Extract a single XML attribute by name. Handles both quote styles. */
function attr(el: string, name: string): string {
  let re = ATTR_REGEX_CACHE.get(name);
  if (!re) {
    re = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`);
    ATTR_REGEX_CACHE.set(name, re);
  }
  const m = el.match(re);
  if (!m) return "";
  const v = m[1] ?? m[2] ?? "";
  return v === "null" ? "" : unescapeXml(v);
}

function contactNameOf(el: string): string | null {
  const name = attr(el, "contact_name");
  return name && name !== "(Unknown)" ? name : null;
}

function externalId(parts: string[]): string {
  return `sms:${crypto.createHash("md5").update(parts.join("|")).digest("hex").slice(0, 16)}`;
}

type AddMessageFn = (addresses: string[], contactName: string | null, msg: ParsedSmsMessage) => void;

function createThreadAccumulator() {
  const threads = new Map<string, ParsedSmsThread>();
  const add: AddMessageFn = (addresses, contactName, msg) => {
    const key = [...new Set(addresses)].sort().join(",");
    if (!key) return;
    let thread = threads.get(key);
    if (!thread) {
      thread = { key, addresses: key.split(","), contactName: null, messages: [] };
      threads.set(key, thread);
    }
    thread.contactName ??= contactName;
    thread.messages.push(msg);
  };
  const finalize = () => {
    for (const t of threads.values()) t.messages.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    return [...threads.values()];
  };
  return { add, finalize };
}

function processSmsElement(el: string, add: AddMessageFn): void {
  const address = cleanPhoneNumberForStorage(attr(el, "address"));
  const date = attr(el, "date");
  const body = attr(el, "body");
  if (!address || !date || !body) return;
  const isOwner = attr(el, "type") !== "1";
  add([address], contactNameOf(el), {
    externalId: externalId([date, address, body]),
    sentAt: new Date(parseInt(date)),
    isOwner,
    senderAddress: isOwner ? null : address,
    content: body,
    hasMedia: false,
  });
}

function processMmsElement(
  el: string,
  ownerPhone: string | null,
  add: AddMessageFn
): string | null {
  let detectedOwner = ownerPhone;
  const date = attr(el, "date");
  if (!date) return detectedOwner;
  const isOwner = attr(el, "msg_box") !== "1";

  let from: string | null = null;
  const others: string[] = [];
  for (const a of el.match(/<addr [^>]*\/>/g) ?? []) {
    const addrType = attr(a, "type");
    const address = cleanPhoneNumberForStorage(attr(a, "address"));
    if (addrType === "151") {
      if (!detectedOwner && address) detectedOwner = address;
      continue;
    }
    if (!address || address === detectedOwner) continue;
    if (addrType === "137") from = address;
    others.push(address);
  }
  // Older exports have no <addrs>; the address attr is tilde-joined
  if (others.length === 0) {
    for (const raw of attr(el, "address").split("~")) {
      const address = cleanPhoneNumberForStorage(raw);
      if (address && address !== detectedOwner) others.push(address);
    }
    from = others[0] ?? null;
  }

  const texts: string[] = [];
  let hasMedia = false;
  for (const part of el.match(/<part [^>]*\/>/g) ?? []) {
    const ct = attr(part, "ct");
    if (ct === "text/plain") texts.push(attr(part, "text"));
    else if (/^(image|video|audio)\//.test(ct)) hasMedia = true;
  }
  const content = texts.join("\n").trim() || null;
  if (!content && !hasMedia) return detectedOwner;

  add(others, contactNameOf(el), {
    externalId: externalId([date, others.join(","), content ?? "media"]),
    sentAt: new Date(parseInt(date)),
    isOwner,
    senderAddress: isOwner ? null : from,
    content,
    hasMedia,
  });
  return detectedOwner;
}

export function parseSmsBackup(xml: string): { threads: ParsedSmsThread[]; ownerPhone: string | null } {
  // MMS addr type 151 is the device owner
  let ownerPhone: string | null = cleanPhoneNumberForStorage(attr(xml.match(/<addr [^>]*type="151"[^>]*\/>/)?.[0] ?? "", "address"));
  const { add, finalize } = createThreadAccumulator();

  for (const el of xml.match(/<sms [^>]*\/>/g) ?? []) {
    processSmsElement(el, add);
  }

  for (const el of xml.match(/<mms [^>]*>[\s\S]*?<\/mms>/g) ?? []) {
    ownerPhone = processMmsElement(el, ownerPhone, add);
  }

  return { threads: finalize(), ownerPhone };
}

/**
 * Streams an SMS Backup & Restore XML file in chunks so multi-hundred-MB
 * backups never load into memory as a single string or block the event loop.
 */
export async function parseSmsBackupStream(
  filePath: string
): Promise<{ threads: ParsedSmsThread[]; ownerPhone: string | null }> {
  let ownerPhone: string | null = null;
  const { add, finalize } = createThreadAccumulator();
  const stream = fs.createReadStream(filePath, { encoding: "utf-8", highWaterMark: 256 * 1024 });

  let buffer = "";
  for await (const chunk of stream) {
    buffer += chunk;
    let pos = 0;

    while (pos < buffer.length) {
      const idxSms = buffer.indexOf("<sms ", pos);
      const idxMms = buffer.indexOf("<mms ", pos);
      if (idxSms === -1 && idxMms === -1) {
        // Keep trailing 4 chars in case "<sms " or "<mms " spans a chunk boundary
        pos = Math.max(pos, buffer.length - 4);
        break;
      }

      const isSms = idxSms !== -1 && (idxMms === -1 || idxSms < idxMms);
      if (isSms) {
        const endIdx = buffer.indexOf("/>", idxSms);
        if (endIdx === -1) {
          pos = idxSms;
          break;
        }
        processSmsElement(buffer.slice(idxSms, endIdx + 2), add);
        pos = endIdx + 2;
      } else {
        const endIdx = buffer.indexOf("</mms>", idxMms);
        if (endIdx === -1) {
          pos = idxMms;
          break;
        }
        ownerPhone = processMmsElement(buffer.slice(idxMms, endIdx + 6), ownerPhone, add);
        pos = endIdx + 6;
      }
    }

    buffer = pos > 0 ? buffer.slice(pos) : buffer;
  }

  return { threads: finalize(), ownerPhone };
}
