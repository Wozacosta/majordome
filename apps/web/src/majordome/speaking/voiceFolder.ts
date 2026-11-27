/** Where the voice lives in the browser's private storage: one folder per file set. */
const ROOT = "majordome-voices";

type Storage = Pick<StorageManager, "getDirectory">;

export async function voiceFolder(
  catalogId: string,
  storage: Storage = navigator.storage,
): Promise<FileSystemDirectoryHandle> {
  const root = await (await storage.getDirectory()).getDirectoryHandle(ROOT, { create: true });
  return root.getDirectoryHandle(catalogId, { create: true });
}

/** Removes every file set, so a set this graphics card no longer uses does not stay behind. */
export async function removeVoiceFolders(storage: Storage = navigator.storage): Promise<void> {
  try {
    await (await storage.getDirectory()).removeEntry(ROOT, { recursive: true });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
  }
}
