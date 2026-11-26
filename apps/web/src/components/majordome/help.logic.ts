const REPOSITORY_URL = "https://github.com/Wozacosta/majordome";

export const GUIDES_URL = `${REPOSITORY_URL}/tree/main/docs/user`;

export interface ClientPlatform {
  readonly userAgent: string;
  readonly desktopApp: boolean;
  /** Opened from a phone's Home Screen rather than in a browser tab. */
  readonly homeScreen: boolean;
}

function systemName(userAgent: string) {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "iOS";
  if (/Android/.test(userAgent)) return "Android";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/Mac OS X|Macintosh/.test(userAgent)) return "macOS";
  if (/Linux|X11/.test(userAgent)) return "Linux";
  return null;
}

function browserName(userAgent: string) {
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/Firefox\/|FxiOS\//.test(userAgent)) return "Firefox";
  if (/Chrome\/|CriOS\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return "A browser";
}

/** Where the app runs, in a few words: "Desktop app on macOS", "Safari on iOS, from the Home Screen". */
export function describePlatform({ userAgent, desktopApp, homeScreen }: ClientPlatform) {
  const system = systemName(userAgent);
  const where = `${desktopApp ? "Desktop app" : browserName(userAgent)}${system ? ` on ${system}` : ""}`;
  return homeScreen && !desktopApp ? `${where}, from the Home Screen` : where;
}

/**
 * A new problem report with the version and platform filled in. It carries only those two: what
 * went wrong is for the person to write, and nothing of theirs is read to help them.
 */
export function problemReportUrl(version: string, platform: ClientPlatform) {
  const query = new URLSearchParams({
    template: "majordome-problem.yml",
    version,
    environment: describePlatform(platform),
  });
  return `${REPOSITORY_URL}/issues/new?${query.toString()}`;
}
