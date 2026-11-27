// @effect-diagnostics nodeBuiltinImport:off - standalone generation uses synchronous Node I/O.
// @effect-diagnostics globalConsole:off - standalone maintenance command output.
/**
 * Writes `site/map.html`, the landing page's example of the map of what the assistant has. It is
 * the app's own drawing with made-up notes, in the site's colours. Run again after the map
 * changes: `vp run --filter t3 site-map:sync`.
 */
import * as NodeFS from "node:fs";

import { format } from "vite-plus/fmt";

import { renderChatSetupPage } from "../src/majordome/chatSetupPage.ts";

const THEME = `
:root{color-scheme:light dark;--font-sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--font-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--radius:10px;
--foreground:#14161c;--muted-foreground:#5d5f66;--card:#fffdf9;--border:#14161c26;--secondary:#14161c0f;--secondary-foreground:#14161c;--primary:#14161c;--ring:#14161c;--success:#17804a;--warning:#c9731a;--code-background:#14161c0d;--chart-1:#3565c9;--chart-2:#17804a;--chart-3:#b8650f}
@media (prefers-color-scheme:dark){:root{--foreground:#f4efe6;--muted-foreground:#a9a59c;--card:#22252e;--border:#f4efe62e;--secondary:#f4efe614;--secondary-foreground:#f4efe6;--primary:#f4efe6;--ring:#f4efe6;--success:#3ddc84;--warning:#f0a550;--code-background:#f4efe60f;--chart-1:#86a8ff;--chart-2:#3ddc84;--chart-3:#f0a550}}
html,body{margin:0;background:transparent}body{padding:16px 4px 4px}`;

// The landing page gives the frame the height of the map, which grows when a box opens.
const REPORT_HEIGHT = `(function(){function tell(){parent.postMessage({majordomeMapHeight:document.body.offsetHeight},"*")}tell();addEventListener("load",tell);new ResizeObserver(tell).observe(document.body)})();`;

const { html } = renderChatSetupPage({
  setup: {
    startsWith: {
      instructions: ["AGENTS.md"],
      skills: [
        {
          name: "file-receipts",
          description: "Files a receipt under the right month and adds it to the ledger.",
        },
        { name: "weekly-recap", description: "Writes Friday's recap from the week's daily notes." },
        { name: "book-a-table", description: "Finds a table and holds it until you confirm." },
      ],
      memoryNote: "memory.md",
      aboutYou: { note: "me.md" },
      dailyNotes: ["daily/2026-11-27.md", "daily/2026-11-26.md"],
      topic: { title: "Accounting", folder: "accounting" },
      otherTopics: ["Garden", "Fitness log", "Lisbon move"],
      otherTopicsTotal: 3,
    },
    canUse: {
      connections: [
        { name: "claude.ai Gmail", status: "connected" },
        { name: "claude.ai Google Calendar", status: "connected" },
        { name: "claude.ai Google Drive", status: "needs-auth" },
      ],
    },
    canReach: {
      computer: "Home Mac",
      notesFolder: "/Users/anna/Notes",
      topicFiles: ["invoice-march.pdf", "lease.pdf", "ledger-2026.xlsx"],
      topicFilesTotal: 14,
      savedKeys: [
        { name: "garmin", note: "Reads runs and sleep" },
        { name: "bank", note: "Downloads statements" },
      ],
      privateDocuments: ["Passport"],
    },
  },
  opened: {
    texts: {
      "AGENTS.md": "Answer briefly.\nKeep the ledger in euros.",
      "memory.md":
        "- Lives in Lyon\n- No meetings 14:30 to 16:00\n- Accountant: Claire, replies on Tuesdays",
      "daily/2026-11-27.md": "Paid the accountant.\nCalled the bank about the transfer.",
      "daily/2026-11-26.md": "Sent the March invoice.",
    },
    standings: {
      Garden: "Tomatoes are in; water twice a week.",
      "Fitness log": "Week 6 of 12, long run on Sunday.",
      "Lisbon move": "Waiting on the lease.",
    },
    documents: { Passport: "Opened only after your yes" },
  },
  tools: ["Files", "Web search", "Browser", "Routines"],
});

const formatted = await format(
  "map.html",
  html
    .replace(
      "<head>",
      '<head><title>What your assistant can see and do</title><meta name="robots" content="noindex">',
    )
    .replace("</head>", `<style>${THEME}</style></head>`)
    .replace("</body>", `<script>${REPORT_HEIGHT}</script></body>`),
);
if (formatted.errors.length > 0) throw new Error("Could not format the example map.");
NodeFS.writeFileSync(new URL("../../../site/map.html", import.meta.url), formatted.code);
console.log("Generated site/map.html.");
