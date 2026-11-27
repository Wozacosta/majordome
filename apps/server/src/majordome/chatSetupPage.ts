/**
 * A chat's setup drawn as a map: the chat in the middle, a branch to each thing it knows, can use
 * and can reach. Majordome draws it, so it looks the same whichever assistant is asked; the
 * assistant only shows it, with `html_render`.
 */

import type { ChatSetup, ChatSetupOpened, ChatSetupPart } from "./chatSetup.ts";

/** The page's fixed words. An assistant gives them in the owner's language with `words`. */
export const CHAT_SETUP_WORDS = [
  "This chat",
  "Knows",
  "Can use",
  "Can reach",
  "Your instructions",
  "Skills",
  "Memory note",
  "Daily notes",
  "This topic",
  "Other topics",
  "Only where each stands",
  "Connections",
  "Its own tools",
  "Notes folder",
  "This topic's files",
  "Saved keys",
  "By name, never the value",
  "Private documents",
  "Asks you each time",
  "None",
  "Could not be read",
  "Has it now",
  "By name, or asks first",
  "Connected",
  "Needs sign-in",
  "Not in use",
] as const;
type Word = (typeof CHAT_SETUP_WORDS)[number];

const CHIPS_SHOWN = 8;

/** Paths of the pages this server drew, which `html_render` shows whatever the chat may read. */
const drawnPages = new Set<string>();
export const rememberDrawnPage = (path: string) => void drawnPages.add(path);
export const isDrawnPage = (path: string) => drawnPages.has(path);

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const ICONS = {
  hub: '<path d="M4 17a8 8 0 0 1 16 0zM2.5 17h19M12 9V7"/><circle cx="12" cy="6" r="1"/>',
  instructions: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
  skills: '<path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.4l6-.8z"/>',
  memory:
    '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 0V7a3 3 0 0 0-3-3zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 0"/>',
  daily: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
  topic: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  topics:
    '<circle cx="6" cy="12" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 11l8-4M8 13l8 4"/>',
  connections: '<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5"/>',
  tools: '<path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L3 18l3 3 6.2-6.2a4 4 0 0 0 5.3-5.3L15 12l-3-3z"/>',
  computer: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  files:
    '<path d="M21 12l-8.5 8.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 8"/>',
  keys: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',
  documents:
    '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
} as const;

interface Chip {
  readonly text: string;
  /** A status dot: `ok` works now, `warn` needs the owner, `off` is not in use. */
  readonly dot?: "ok" | "warn" | "off" | undefined;
}

/** One line of an opened box. */
interface Row {
  readonly name: string;
  readonly note?: string | undefined;
  readonly dot?: Chip["dot"];
}

interface Node {
  readonly icon: keyof typeof ICONS;
  readonly title: string;
  readonly detail?: string | undefined;
  readonly chips?: ReadonlyArray<Chip> | undefined;
  /** How many there are when `chips` holds only the first few. */
  readonly total?: number | undefined;
  /** Shown when the box is opened, in place of the chips: every one, each with what it is. */
  readonly rows?: ReadonlyArray<Row> | undefined;
  /** Shown when the box is opened: the start of each note it stands for, by name. */
  readonly texts?: ReadonlyArray<readonly [name: string, text: string]> | undefined;
  /** Dotted: the chat has only the names, or must ask the owner first. */
  readonly soft?: boolean;
  /** Faded: there is nothing there. */
  readonly none?: boolean;
}

const CONNECTION_DOTS: Record<string, Chip["dot"]> = {
  connected: "ok",
  "needs-auth": "warn",
  failed: "warn",
  pending: "off",
  disabled: "off",
};

/** "claude.ai Gmail" and "plugin:vercel:vercel" as the owner would say them. */
const connectionName = (name: string) =>
  name.replace(/^claude\.ai /, "").replace(/^plugin:(?:[^:]*:)?/, "");

const STYLE = `
.map{position:relative;display:grid;grid-template-columns:1fr auto 1fr;column-gap:64px;align-items:center;font-family:var(--font-sans);color:var(--foreground)}
.wires{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.wires path{fill:none;stroke-width:1.5;stroke-linecap:round;opacity:.7}
.wires path.soft{stroke-dasharray:2 5}
.wires.intro path:not(.soft){stroke-dasharray:1;stroke-dashoffset:1;animation:draw .7s cubic-bezier(.3,0,.2,1) forwards}
.wires.intro path.soft,.wires.intro circle{animation:fade .7s ease-out}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes fade{from{opacity:0}}
.side{display:flex;flex-direction:column;min-width:0;z-index:1}
.branch{display:flex;flex-direction:column;gap:8px}
.branch+.branch{margin-top:22px}
.branch>h2{margin:0 2px 2px;font-size:12px;font-weight:600;line-height:1.3;color:var(--tone)}
.k{--tone:var(--chart-1)}.u{--tone:var(--chart-2)}.r{--tone:var(--chart-3)}
.left .branch>h2{text-align:right}
.node{box-sizing:border-box;padding:10px 12px;border:1px solid var(--border);border-radius:calc(var(--radius) + 2px);background:var(--card);min-width:0;transition:border-color .15s}
.node.soft{border-style:dashed}
.node.none{opacity:.55}
.face{display:flex;gap:10px;align-items:flex-start}
summary.face{list-style:none;cursor:pointer;border-radius:4px}
summary.face::-webkit-details-marker{display:none}
summary.face:focus-visible{outline:2px solid var(--ring);outline-offset:6px}
details.node:hover,details.node[open]{border-color:color-mix(in srgb,var(--tone) 50%,var(--border))}
.caret{flex:none;margin:7px 0 0 auto;width:14px;height:14px;stroke:var(--muted-foreground);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .22s cubic-bezier(.2,0,0,1)}
details.node.on .caret{transform:rotate(180deg)}
details.node.on .chips{display:none}
.ic{flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:color-mix(in srgb,var(--tone) 14%,transparent)}
.ic svg{width:16px;height:16px;stroke:var(--tone);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.body{min-width:0;flex:1;padding-top:1px}
.t{font-size:13px;font-weight:600;line-height:1.35}
.s{font-size:11.5px;color:var(--muted-foreground);line-height:1.35;overflow-wrap:anywhere}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px}
.chip{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:1px 8px;border-radius:999px;background:var(--secondary);color:var(--secondary-foreground);font-size:11.5px;line-height:1.6;overflow-wrap:anywhere}
.chip i{flex:none;width:6px;height:6px;border-radius:50%;background:var(--success)}
.chip i.warn{background:var(--warning)}.chip i.off{background:var(--muted-foreground)}
.chip.more{background:none;color:var(--muted-foreground);padding-left:2px}
.open{margin:10px 0 2px 38px;display:flex;flex-direction:column}
details.node.on .open{animation:fade .22s ease-out}
.row{padding:6px 0;font-size:12px;line-height:1.4;overflow-wrap:anywhere}
.row+.row{border-top:1px solid var(--border)}
.row b{font-weight:600}.row i{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:6px;vertical-align:middle;background:var(--success)}
.row i.warn{background:var(--warning)}.row i.off{background:var(--muted-foreground)}
.row span{display:block;color:var(--muted-foreground);font-size:11.5px}
.text+.text{margin-top:8px}
.text h3{margin:0 0 3px;font-size:11px;font-weight:600;color:var(--muted-foreground)}
.text pre{margin:0;padding:8px 10px;max-height:220px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--font-mono);font-size:11px;line-height:1.5;background:var(--code-background);border-radius:calc(var(--radius) - 2px)}
.hub{z-index:1;width:112px;height:112px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;text-align:center;background:var(--card);border:1.5px solid var(--primary);box-shadow:0 0 0 7px color-mix(in srgb,var(--primary) 11%,transparent),0 0 0 15px color-mix(in srgb,var(--primary) 5%,transparent)}
.hub svg{width:26px;height:26px;stroke:var(--primary);fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.hub b{font-size:12px;font-weight:600;line-height:1.2;max-width:88px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:20px;font-family:var(--font-sans);font-size:11.5px;color:var(--muted-foreground)}
.legend span{display:inline-flex;align-items:center;gap:7px}
.legend em{width:22px;border-top:1.5px solid var(--muted-foreground)}
.legend em.soft{border-top-style:dotted;border-top-width:2px}
@media (max-width:560px){
.map{grid-template-columns:1fr;row-gap:20px}
.hub{order:1;width:88px;height:88px;justify-self:start;margin:15px 0 0 15px}
.side{padding-left:36px}
.left{order:2}.right{order:3}
.left .branch>h2{text-align:left}
}
@media (prefers-reduced-motion:reduce){.wires.intro path,.wires.intro circle,details.node.on .open{animation:none!important;stroke-dasharray:none}.wires.intro path.soft{stroke-dasharray:2 5}.caret{transition:none}}`;

// Each wire runs from the hub to its node: a curve on a wide page, a trunk with elbows on a phone.
// A box opens and closes over 220ms; the wires follow it, redrawn as the map changes height.
const SCRIPT = `(function(){var map=document.getElementById("map"),svg=document.getElementById("wires"),hub=document.getElementById("hub"),still=matchMedia("(prefers-reduced-motion:reduce)").matches;
function draw(){var m=map.getBoundingClientRect(),h=hub.getBoundingClientRect(),narrow=getComputedStyle(map).gridTemplateColumns.split(" ").length<3,out="";
map.querySelectorAll(".node").forEach(function(node){var n=node.getBoundingClientRect(),tone=getComputedStyle(node).getPropertyValue("--tone"),y=n.top-m.top+Math.min(n.height/2,25),soft=node.classList.contains("soft"),d,x0,x1;
if(narrow){x0=h.left-m.left+18;x1=n.left-m.left;d="M"+x0+" "+(h.bottom-m.top+2)+" V"+(y-10)+" Q"+x0+" "+y+" "+(x0+10)+" "+y+" H"+x1}
else{var left=n.right<h.left,cy=h.top-m.top+h.height/2;x1=(left?n.right:n.left)-m.left;x0=h.left-m.left+h.width/2+(left?-1:1)*(h.width/2+16);var mid=(x0+x1)/2;d="M"+x0+" "+cy+" C"+mid+" "+cy+" "+mid+" "+y+" "+x1+" "+y}
out+='<path d="'+d+'" stroke="'+tone+'"'+(soft?' class="soft"':' pathLength="1"')+'/><circle cx="'+x1+'" cy="'+y+'" r="3" fill="'+tone+'"/>'});
svg.innerHTML=out}
if(!still){svg.classList.add("intro");setTimeout(function(){svg.classList.remove("intro")},900)}
draw();new ResizeObserver(draw).observe(map);
map.querySelectorAll("details.node").forEach(function(box){var run=null,closing=false;
box.querySelector("summary").addEventListener("click",function(event){event.preventDefault();
var from=box.getBoundingClientRect().height,open=box.open&&!closing;
if(run){run.onfinish=null;run.cancel()}
closing=open;box.open=!open;box.classList.toggle("on",!open);
var to=box.getBoundingClientRect().height;
if(still){closing=false;return}
if(open)box.open=true;
box.style.overflow="hidden";
run=box.animate({height:[from+"px",to+"px"]},{duration:220,easing:"cubic-bezier(.2,0,0,1)"});
run.onfinish=function(){box.style.overflow="";if(closing)box.open=false;closing=false;run=null}})})})();`;

const icon = (name: keyof typeof ICONS) => `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;

function renderNode(node: Node): string {
  const chips = node.chips ?? [];
  const shown = chips.slice(0, CHIPS_SHOWN);
  const more = (node.total ?? chips.length) - shown.length;
  const classes = ["node", node.soft === true ? "soft" : "", node.none === true ? "none" : ""]
    .filter(Boolean)
    .join(" ");
  const rows = node.rows ?? [];
  const texts = node.texts ?? [];
  const opens = rows.length > 0 || texts.length > 0;
  const face = [
    `<span class="ic">${icon(node.icon)}</span><div class="body">`,
    `<div class="t">${escapeHtml(node.title)}</div>`,
    node.detail === undefined ? "" : `<div class="s">${escapeHtml(node.detail)}</div>`,
    shown.length === 0
      ? ""
      : `<div class="chips">${shown
          .map(
            (chip) =>
              `<span class="chip">${chip.dot === undefined ? "" : `<i class="${chip.dot}"></i>`}${escapeHtml(chip.text)}</span>`,
          )
          .join("")}${more > 0 ? `<span class="chip more">+${more}</span>` : ""}</div>`,
    "</div>",
  ].join("");
  if (!opens) return `<div class="${classes}"><div class="face">${face}</div></div>`;
  const opened = [
    ...rows.map(
      (row) =>
        `<div class="row">${row.dot === undefined ? "" : `<i class="${row.dot}"></i>`}<b>${escapeHtml(row.name)}</b>${row.note === undefined || row.note.trim() === "" ? "" : `<span>${escapeHtml(row.note)}</span>`}</div>`,
    ),
    ...texts.map(
      ([name, text]) =>
        `<div class="text">${texts.length > 1 ? `<h3>${escapeHtml(name)}</h3>` : ""}<pre>${escapeHtml(text)}</pre></div>`,
    ),
  ].join("");
  return `<details class="${classes}"><summary class="face">${face}<svg class="caret" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></summary><div class="open">${opened}</div></details>`;
}

const renderBranch = (tone: "k" | "u" | "r", title: string, nodes: ReadonlyArray<Node>) =>
  nodes.length === 0
    ? ""
    : `<div class="branch ${tone}"><h2>${escapeHtml(title)}</h2>${nodes.map(renderNode).join("")}</div>`;

const names = (values: ReadonlyArray<string>): ReadonlyArray<Chip> =>
  values.map((text) => ({ text }));

/** The page and the frame height to ask `html_render` for; the frame then fits the page itself. */
export function renderChatSetupPage(input: {
  readonly setup: ChatSetup;
  /** What a box shows once opened; without it no box opens. */
  readonly opened?: ChatSetupOpened | undefined;
  /** The assistant's own kinds of tools, which only it knows. */
  readonly tools?: ReadonlyArray<string> | undefined;
  /** The fixed words in the owner's language, by their English. */
  readonly words?: Readonly<Record<string, string>> | undefined;
}): { readonly html: string; readonly height: number } {
  const { startsWith, canUse, canReach } = input.setup;
  const w = (word: Word) => input.words?.[word]?.trim() || word;
  const unread = new Set<ChatSetupPart>(input.setup.couldNotRead);
  /** A list that may be empty or unread: faded with the reason, never left out. */
  const list = (
    part: ChatSetupPart,
    node: Omit<Node, "none">,
    rows: ReadonlyArray<Row>,
    total?: number,
  ): Node =>
    unread.has(part)
      ? { icon: node.icon, title: node.title, detail: w("Could not be read"), none: true }
      : rows.length === 0
        ? { icon: node.icon, title: node.title, detail: w("None"), none: true }
        : {
            ...node,
            chips: rows.map((row) => ({ text: row.name, dot: row.dot })),
            total,
            // Opening adds something when a row says what it is, or the chips left some out.
            rows:
              rows.some((row) => (row.note ?? "").trim() !== "") || rows.length > CHIPS_SHOWN
                ? total !== undefined && total > rows.length
                  ? [...rows, { name: `+${total - rows.length}` }]
                  : rows
                : undefined,
          };
  /** The starts of the loaded notes among `paths`, for a box that opens onto them. */
  const textsOf = (paths: ReadonlyArray<string>) =>
    paths.flatMap((name): Array<readonly [string, string]> => {
      const text = input.opened?.texts[name];
      return text === undefined ? [] : [[name, text]];
    });
  const STATUS_WORDS = {
    ok: w("Connected"),
    warn: w("Needs sign-in"),
    off: w("Not in use"),
  } as const;

  const knows: Array<Node> = [];
  if (startsWith.instructions.length > 0) {
    knows.push({
      icon: "instructions",
      title: w("Your instructions"),
      detail: startsWith.instructions.join(", "),
      texts: textsOf(startsWith.instructions),
    });
  }
  if (startsWith.skills.length > 0 || unread.has("skills")) {
    knows.push(
      list(
        "skills",
        { icon: "skills", title: w("Skills") },
        startsWith.skills.map((skill) => ({ name: skill.name, note: skill.description })),
      ),
    );
  }
  if (startsWith.memoryNote !== undefined) {
    knows.push({
      icon: "memory",
      title: w("Memory note"),
      detail: startsWith.memoryNote,
      texts: textsOf([startsWith.memoryNote]),
    });
  }
  if (startsWith.dailyNotes.length > 0) {
    knows.push({
      icon: "daily",
      title: w("Daily notes"),
      detail: startsWith.dailyNotes.map((note) => note.replace(/^.*\//, "")).join(", "),
      texts: textsOf(startsWith.dailyNotes),
    });
  }
  if (startsWith.topic !== undefined) {
    knows.push({ icon: "topic", title: w("This topic"), detail: startsWith.topic.title });
  }
  if (startsWith.otherTopics.length > 0) {
    knows.push({
      icon: "topics",
      title: w("Other topics"),
      detail: w("Only where each stands"),
      chips: names(startsWith.otherTopics),
      total: startsWith.otherTopicsTotal,
      rows: startsWith.otherTopics.map((name) => ({
        name,
        note: input.opened?.standings[name],
      })),
      soft: true,
    });
  }

  const uses: Array<Node> = [];
  if (canUse.connections !== undefined || unread.has("connections")) {
    uses.push(
      list(
        "connections",
        { icon: "connections", title: w("Connections") },
        (canUse.connections ?? []).map((connection) => {
          const dot = CONNECTION_DOTS[connection.status] ?? "off";
          return { name: connectionName(connection.name), dot, note: STATUS_WORDS[dot] };
        }),
      ),
    );
  }
  const tools = (input.tools ?? []).map((tool) => tool.trim()).filter((tool) => tool !== "");
  if (tools.length > 0) {
    uses.push({ icon: "tools", title: w("Its own tools"), chips: names(tools) });
  }

  const reaches: Array<Node> = [];
  if (canReach.notesFolder !== undefined) {
    reaches.push({
      icon: "computer",
      title: w("Notes folder"),
      detail: `${canReach.notesFolder.replace(/^.*\//, "")} · ${canReach.computer}`,
      rows: [{ name: canReach.notesFolder }],
    });
  }
  if (canReach.topicFiles !== undefined || unread.has("topic files")) {
    reaches.push(
      list(
        "topic files",
        { icon: "files", title: w("This topic's files") },
        (canReach.topicFiles ?? []).map((name) => ({ name })),
        canReach.topicFilesTotal,
      ),
    );
  }
  reaches.push(
    list(
      "saved keys",
      { icon: "keys", title: w("Saved keys"), detail: w("By name, never the value") },
      canReach.savedKeys,
    ),
    list(
      "private documents",
      {
        icon: "documents",
        title: w("Private documents"),
        detail: w("Asks you each time"),
        soft: true,
      },
      canReach.privateDocuments.map((name) => ({ name, note: input.opened?.documents[name] })),
    ),
  );

  const html = [
    `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>`,
    '<div class="map" id="map"><svg class="wires" id="wires" aria-hidden="true"></svg>',
    `<div class="side left">${renderBranch("k", w("Knows"), knows)}</div>`,
    `<div class="hub" id="hub">${icon("hub")}<b>${escapeHtml(startsWith.topic?.title ?? w("This chat"))}</b></div>`,
    `<div class="side right">${renderBranch("u", w("Can use"), uses)}${renderBranch("r", w("Can reach"), reaches)}</div>`,
    "</div>",
    `<div class="legend"><span><em></em>${escapeHtml(w("Has it now"))}</span><span><em class="soft"></em>${escapeHtml(w("By name, or asks first"))}</span></div>`,
    `<script>${SCRIPT}</script></body></html>`,
  ].join("");

  // About what the wide page comes to: a node is some 50px, 26px more for each row of chips.
  const tall = (nodes: ReadonlyArray<Node>) =>
    nodes.reduce(
      (sum, node) =>
        sum +
        60 +
        (node.detail === undefined ? 0 : 16) +
        Math.ceil(Math.min(node.chips?.length ?? 0, CHIPS_SHOWN) / 3) * 26,
      28,
    );
  return { html, height: Math.max(tall(knows), tall(uses) + tall(reaches) + 18) + 60 };
}
