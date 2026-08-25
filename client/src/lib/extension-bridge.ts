/**
 * Bridge to the PRM Chrome extension.
 *
 * A web page can only message an extension that names the page's origin in its
 * `externally_connectable.matches`. When it does, Chrome injects a minimal
 * `chrome.runtime` onto the page — so the absence of that object is exactly the
 * signal that the extension is missing, disabled, or built without this origin
 * allow-listed. There is nothing else to feature-detect.
 */

/** App-settings keys holding the extension's identity and job limits. */
export const EXTENSION_ID_SETTING = "chrome_extension_id";
export const EXTENSION_MAX_RECORDS_SETTING = "chrome_extension_max_records";

/** Cap applied to each side of a follower/following walk when unset. */
export const DEFAULT_MAX_RECORDS = 3000;

export type ExtractAction = "account" | "graph";

interface ExtractRequest {
  type: "PRM_EXTRACT_START";
  action: ExtractAction;
  username: string;
  maxRecords: number;
  requestId: string;
}

type ExtractResponse = { ok: true; jobId: string } | { ok: false; reason: string };

/** Chrome exposes only this sliver of the API to an allow-listed web page. */
declare global {
  interface Window {
    chrome?: {
      runtime?: {
        lastError?: { message?: string };
        sendMessage?: (
          extensionId: string,
          message: unknown,
          callback: (response?: ExtractResponse) => void,
        ) => void;
      };
    };
  }
}

/** Why a handoff failed, in words worth showing to a person. */
const FAILURE_REASONS: Record<string, string> = {
  not_paired: "The extension is installed but not paired with this PRM. Enter a pairing code to connect it.",
  busy: "The extension is already running an extraction. Wait for it to finish and try again.",
  bad_origin: "The extension is paired to a different PRM server, so it refused the request.",
  no_username: "This account has no username to look up on Instagram.",
};

export class ExtensionUnavailableError extends Error {}

function describe(reason: string): string {
  return FAILURE_REASONS[reason] ?? `The extension refused the request (${reason}).`;
}

/**
 * Ask the extension to extract `username` and post the result back to PRM.
 *
 * Resolves once the extension has *accepted* the job — the extraction itself
 * runs for minutes afterwards and lands on the Extension Imports page. Throws
 * `ExtensionUnavailableError` when the extension cannot be reached at all,
 * which callers treat as "send them to the setup page".
 */
export function requestExtraction(
  extensionId: string,
  action: ExtractAction,
  username: string,
  maxRecords: number,
): Promise<string> {
  const send = window.chrome?.runtime?.sendMessage;
  if (!send) {
    throw new ExtensionUnavailableError(
      "The PRM Chrome extension isn't installed, or it doesn't allow this PRM origin.",
    );
  }
  if (!extensionId) {
    throw new ExtensionUnavailableError(
      "No extension ID is configured. Copy it from chrome://extensions and paste it into Chrome Extension settings.",
    );
  }

  const request: ExtractRequest = {
    type: "PRM_EXTRACT_START",
    action,
    username,
    maxRecords,
    requestId: crypto.randomUUID(),
  };

  return new Promise((resolve, reject) => {
    send(extensionId, request, (response) => {
      // Chrome reports an unreachable extension here rather than by throwing.
      const lastError = window.chrome?.runtime?.lastError;
      if (lastError) {
        reject(
          new ExtensionUnavailableError(
            "The extension didn't respond. Check that it's installed, enabled, and that its ID matches.",
          ),
        );
        return;
      }

      // A reply of undefined means the extension received the message but
      // nothing handled it — its background worker predates this feature.
      if (!response) {
        reject(
          new ExtensionUnavailableError(
            "The extension is running an older build. Reload it at chrome://extensions and try again.",
          ),
        );
        return;
      }

      if (response.ok) resolve(response.jobId);
      else reject(new Error(describe(response.reason)));
    });
  });
}
