/** Where an app sends the browser after a sign-in, for a Majordome reached at a given address. */

export const CONNECTION_CALLBACK_PATH = "/oauth/connections/callback";

/**
 * Apps warn about a sign-in that returns to an address on the person's own computer, so those
 * return through this page, which passes the browser on. `site/connect/back` holds it.
 */
export const CONNECTION_RETURN_PAGE = "https://majord.me/connect/back";

// Loopback, the private and carrier-grade ranges, and the names a home network or Tailscale gives.
const LOCAL_ORIGIN =
  /^http:\/\/(localhost|127(\.\d{1,3}){3}|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])(\.\d{1,3}){2}|[a-z0-9-]+\.local|[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net)(:\d{1,5})?$/;

/** A Majordome on the person's own computer or network, which only their own browser reaches. */
export const isLocalMajordomeOrigin = (origin: string): boolean => LOCAL_ORIGIN.test(origin);

const base64Url = (text: string) =>
  btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

/**
 * The address to give an app, and the `state` to send with it. A Majordome on https is returned
 * to directly. A local one is returned to through the page above, which reads the address to
 * pass the browser on to from the end of `state`. Null for an address neither can serve.
 */
export function connectionCallback(input: {
  /** The address the person's browser reaches this Majordome at, as `URL.origin` gives it. */
  readonly origin: string;
  readonly nonce: string;
}): { readonly redirectUri: string; readonly state: string } | null {
  if (/^https:\/\/[^/]+$/.test(input.origin)) {
    return { redirectUri: `${input.origin}${CONNECTION_CALLBACK_PATH}`, state: input.nonce };
  }
  if (isLocalMajordomeOrigin(input.origin)) {
    return {
      redirectUri: CONNECTION_RETURN_PAGE,
      state: `${input.nonce}.${base64Url(input.origin)}`,
    };
  }
  return null;
}
