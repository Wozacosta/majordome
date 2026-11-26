/** Saves what a URL serves as a file on this device. False when the URL could not be read. */
export async function saveUrlAsFile(url: string, name: string): Promise<boolean> {
  const response = await fetch(url);
  if (!response.ok) return false;
  // A blob keeps desktop's custom app scheme from navigating to an external browser.
  const blobUrl = URL.createObjectURL(await response.blob());
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = name;
  anchor.click();
  return true;
}
