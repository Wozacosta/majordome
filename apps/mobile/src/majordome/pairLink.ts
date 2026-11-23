/**
 * A server's own pairing address (`https://<server>/pair#token=<code>`), which the phone hands to
 * the app for the domains it trusts, as the app's link to its add-a-computer screen with that
 * address filled in. Any other address is returned as it came.
 */
export function pairLinkAsAppLink(url: string, appBase: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== "https:" || parsed.pathname.replace(/\/+$/, "") !== "/pair") return url;
  const token =
    new URLSearchParams(parsed.hash.slice(1)).get("token") ?? parsed.searchParams.get("token");
  if (!token) return url;
  return `${appBase}connections/new?${new URLSearchParams([["pairingUrl", url]])}`;
}
