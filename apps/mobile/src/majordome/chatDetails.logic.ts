const MEDIA_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mov: "video/quicktime",
  zip: "application/zip",
};

/** What kind of file a name says it is; a topic's file list carries names, not kinds. */
export function fileMediaType(name: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase();
  return (extension && MEDIA_TYPES[extension]) || "application/octet-stream";
}

/** The header button that opens a chat's key facts and, for a topic, its files. */
export const CHAT_DETAILS_LABEL = "Key facts and files";

export interface PickedFile {
  readonly uri: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

/** The files chosen in the phone's own picker: empty when it was closed, null when it would not open. */
export async function pickFiles(): Promise<ReadonlyArray<PickedFile> | null> {
  const { getDocumentAsync } = await import("expo-document-picker");
  // A readable copy: the phone's own file providers hand out addresses that can't be uploaded.
  const picked = await getDocumentAsync({ multiple: true, copyToCacheDirectory: true }).catch(
    () => null,
  );
  if (picked === null) return null;
  return picked.canceled
    ? []
    : picked.assets.map((asset) => ({
        uri: asset.uri,
        // The server refuses a blank name, which Android's picker can hand out.
        name: asset.name.trim().length > 0 ? asset.name : "file",
        mimeType: asset.mimeType || "application/octet-stream",
        sizeBytes: asset.size ?? 0,
      }));
}

/** Sends a picked file's bytes to an upload address; false when they did not arrive. */
export async function uploadPickedFile(url: string, file: PickedFile): Promise<boolean> {
  const { File, UploadType } = await import("expo-file-system");
  return new File(file.uri)
    .upload(url, {
      httpMethod: "POST",
      uploadType: UploadType.BINARY_CONTENT,
      headers: { "Content-Type": file.mimeType },
    })
    .then(
      (response) => response.status >= 200 && response.status < 300,
      () => false,
    );
}
