/**
 * The files behind private documents: one `age` file per document, a small index of what each is,
 * and an append-only access log. Plain functions; `MajordomePrivateDocuments` owns the folder.
 */

import {
  MajordomePrivateDocument,
  MajordomePrivateDocumentAccess,
  MajordomePrivateDocumentError,
} from "@t3tools/contracts";
import { Decrypter, Encrypter, identityToRecipient } from "age-encryption";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const Index = Schema.fromJsonString(Schema.Array(MajordomePrivateDocument));
export const encodeIndex = Schema.encodeSync(Index);
export const decodeIndex = Schema.decodeUnknownOption(Index);

const AccessLine = Schema.fromJsonString(MajordomePrivateDocumentAccess);
const encodeAccessLine = Schema.encodeSync(AccessLine);
const decodeAccessLine = Schema.decodeUnknownOption(AccessLine);

const ACCESS_LOG_SHOWN = 300;

export const accessLogLine = (entry: MajordomePrivateDocumentAccess) =>
  `${encodeAccessLine(entry)}\n`;

/** The log's last entries, newest first. A line that does not parse is skipped, never fatal. */
export function readAccessLog(
  text: string,
  limit = ACCESS_LOG_SHOWN,
): ReadonlyArray<MajordomePrivateDocumentAccess> {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(-limit)
    .flatMap((line) => Option.toArray(decodeAccessLine(line)))
    .toReversed();
}

/** The document an agent or the owner named: its exact name, whatever the letter case. */
export function findDocumentByName(
  documents: ReadonlyArray<MajordomePrivateDocument>,
  name: string,
): MajordomePrivateDocument | undefined {
  const wanted = name.trim().toLowerCase();
  return documents.find((document) => document.name.toLowerCase() === wanted);
}

/** The original file name, safe as one path segment, so the agent sees a familiar name and type. */
export function safeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).at(-1) ?? "";
  const cleaned = base
    .replaceAll(/[\u0000-\u001f\u007f]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return cleaned === "" ? "document" : cleaned;
}

export const encryptDocument = (plain: Uint8Array, identity: string) =>
  Effect.tryPromise({
    try: async () => {
      const encrypter = new Encrypter();
      encrypter.addRecipient(await identityToRecipient(identity));
      return await encrypter.encrypt(plain);
    },
    catch: (cause) => new MajordomePrivateDocumentError({ reason: "storage_failed", cause }),
  }).pipe(Effect.withSpan("majordome.encryptPrivateDocument"));

export const decryptDocument = (encrypted: Uint8Array, identity: string) =>
  Effect.tryPromise({
    try: async () => {
      const decrypter = new Decrypter();
      decrypter.addIdentity(identity);
      return await decrypter.decrypt(encrypted);
    },
    catch: (cause) => new MajordomePrivateDocumentError({ reason: "decrypt_failed", cause }),
  }).pipe(Effect.withSpan("majordome.decryptPrivateDocument"));
