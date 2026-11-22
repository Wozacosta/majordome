const RELEASES = "https://github.com/Wozacosta/majordome/releases";

// The DMG's file name carries its version, so the version is read from the update feed the app
// itself uses. The GitHub API would also answer, but it rate-limits Vercel's shared addresses.
export async function GET(request) {
  const arch = new URL(request.url).searchParams.get("arch") === "x64" ? "x64" : "arm64";
  const headers = { "Cache-Control": "no-store", Location: `${RELEASES}/latest` };
  try {
    const feed = await fetch(`${RELEASES}/latest/download/latest-mac.yml`, {
      signal: AbortSignal.timeout(4000),
    });
    const version = feed.ok ? /^version:\s*'?([\w.-]+)'?\s*$/m.exec(await feed.text())?.[1] : null;
    if (version) {
      headers.Location = `${RELEASES}/download/v${version}/Majordome-${version}-${arch}.dmg`;
      headers["Cache-Control"] = "public, max-age=0, s-maxage=300, stale-while-revalidate=3600";
    }
  } catch {
    // Falls back to the release page.
  }
  return new Response(null, { status: 302, headers });
}
