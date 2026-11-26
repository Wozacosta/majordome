/**
 * A link an assistant writes to one of the app's own screens, such as `app://settings/phone`. The
 * client that shows the message decides whether it has that screen; elsewhere the label is text.
 */
export const APP_SCREEN_LINK_PROTOCOL = "app";
const PREFIX = `${APP_SCREEN_LINK_PROTOCOL}://`;
const SCREEN_PATH = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;

export function appScreenHref(pathname: `/${string}`): string {
  return `${PREFIX}${pathname.slice(1)}`;
}

/** The screen's path in the app, such as `/settings/phone`; null for any other link. */
export function parseAppScreenHref(href: string): string | null {
  if (!href.startsWith(PREFIX)) return null;
  const path = href.slice(PREFIX.length).replace(/\/+$/, "");
  return SCREEN_PATH.test(path) ? `/${path}` : null;
}

/** The Markdown an assistant is shown and asked to write. */
export function formatAppScreenLink(label: string, pathname: `/${string}`): string {
  return `[${label}](${appScreenHref(pathname)})`;
}
