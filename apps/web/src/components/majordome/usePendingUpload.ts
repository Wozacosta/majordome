import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import type { EnvironmentId } from "@t3tools/contracts";

import { attachmentEnvironment } from "../../state/attachments";
import { readPreparedConnection } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";

export type PendingUpload =
  | { readonly ok: true; readonly attachmentId: string; readonly mediaType: string }
  | { readonly ok: false; readonly message: string };

/**
 * Sends a file to a server the way chat attachments go: a signed upload link, then the bytes over
 * HTTP to that server's own address. What comes back names the upload for the request that keeps it.
 */
export function usePendingUpload(environmentId: EnvironmentId, label: string) {
  const createUploadUrl = useAtomCommand(attachmentEnvironment.createUploadUrl, {
    label,
    reportFailure: false,
    reportDefect: false,
  });
  return async (file: File): Promise<PendingUpload> => {
    const mediaType = file.type || "application/octet-stream";
    const minted = await createUploadUrl({
      environmentId,
      input: { type: "file", name: file.name, mimeType: mediaType, sizeBytes: file.size },
    });
    const connection = readPreparedConnection(environmentId);
    const url =
      minted._tag === "Success" && connection !== null
        ? resolveAssetUrl(connection.httpBaseUrl, minted.value.relativeUrl)
        : null;
    if (minted._tag !== "Success" || url === null) {
      return { ok: false, message: "Could not start the upload. Try again." };
    }
    const sent = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": mediaType },
      body: file,
    }).then(
      (response) => response.ok,
      () => false,
    );
    return sent
      ? { ok: true, attachmentId: minted.value.attachmentId, mediaType }
      : { ok: false, message: "The upload did not arrive. Try again." };
  };
}
