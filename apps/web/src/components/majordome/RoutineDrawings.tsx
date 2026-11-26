import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

const INK = "fill-muted-foreground/25";
const FAINT = "fill-muted-foreground/12";
const ACCENT = "fill-primary";
const ACCENT_TINT = "fill-primary/15";
const LINE = "stroke-muted-foreground/45 [stroke-linecap:round] [stroke-linejoin:round]";
const ACCENT_LINE = "stroke-primary [stroke-linecap:round] [stroke-linejoin:round]";
const SHEET = "fill-background stroke-border";

/** A grey bar standing in for a line of text nobody needs to read. */
function Bar({
  x,
  y,
  w,
  tone = INK,
}: {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly tone?: string;
}) {
  return <rect x={x} y={y} width={w} height={4} rx={2} className={tone} />;
}

/** A to-do's box, ticked or not. */
function Box({ x, y, done = false }: { readonly x: number; readonly y: number; done?: boolean }) {
  return done ? (
    <>
      <rect x={x} y={y} width={8} height={8} rx={2.5} className={ACCENT} />
      <path
        d={`M${x + 2.2} ${y + 4.2}l1.4 1.4 2.4-2.8`}
        strokeWidth={1.2}
        className="stroke-primary-foreground [stroke-linecap:round] [stroke-linejoin:round]"
      />
    </>
  ) : (
    <rect x={x + 0.5} y={y + 0.5} width={7} height={7} rx={2} strokeWidth={1} className={LINE} />
  );
}

/** The sheet every drawing is made on: what arrives when the routine has run. */
function Sheet({ children, dashed = false }: { readonly children: ReactNode; dashed?: boolean }) {
  return (
    <>
      <rect
        x={46}
        y={11}
        width={108}
        height={78}
        rx={8}
        strokeWidth={1}
        {...(dashed ? { strokeDasharray: "3 3" } : {})}
        className={dashed ? "fill-background/60 stroke-muted-foreground/45" : SHEET}
      />
      {children}
    </>
  );
}

/** Emails waiting, the most pressing one with its reply drafted. */
const reply = (
  <Sheet>
    {[24, 44, 64].map((y, index) => (
      <g key={y}>
        <circle cx={62} cy={y + 6} r={5} className={index === 0 ? ACCENT : INK} />
        <Bar x={73} y={y + 1} w={index === 1 ? 38 : 46} />
        <Bar x={73} y={y + 8} w={index === 2 ? 30 : 24} tone={FAINT} />
      </g>
    ))}
    <path d="M139 26l-4 4 4 4M135 30h6a4 4 0 0 1 4 4v1" strokeWidth={1.5} className={ACCENT_LINE} />
  </Sheet>
);

/** Tomorrow by the hour, the first event picked out. */
const tomorrow = (
  <Sheet>
    <path d="M72 22v56" strokeWidth={1} className={LINE} />
    {[26, 46, 66].map((y) => (
      <Bar key={y} x={56} y={y + 3} w={10} tone={FAINT} />
    ))}
    <rect x={78} y={23} width={58} height={14} rx={4} className={ACCENT_TINT} />
    <rect x={78} y={23} width={3} height={14} rx={1.5} className={ACCENT} />
    <Bar x={86} y={28} w={30} tone="fill-primary/60" />
    <rect x={78} y={43} width={40} height={14} rx={4} className={FAINT} />
    <Bar x={86} y={48} w={20} />
    <rect x={78} y={63} width={64} height={14} rx={4} className={FAINT} />
    <Bar x={86} y={68} w={38} />
  </Sheet>
);

/** One question in the evening, and the answer written under it. */
const journal = (
  <>
    <path d="M172 16a9 9 0 1 0 9 13 7.5 7.5 0 0 1-9-13z" className="fill-primary/70" />
    <Sheet>
      <rect x={56} y={22} width={54} height={15} rx={7.5} className={FAINT} />
      <Bar x={63} y={27.5} w={34} />
      <rect x={84} y={42} width={60} height={15} rx={7.5} className={ACCENT_TINT} />
      <Bar x={91} y={47.5} w={42} tone="fill-primary/60" />
      <Bar x={56} y={66} w={70} />
      <Bar x={56} y={74} w={44} />
      <path d="M104 72v8" strokeWidth={1.5} className={ACCENT_LINE} />
    </Sheet>
  </>
);

/** The week's dinners in a row, over the shopping list. */
const meals = (
  <Sheet>
    {[0, 1, 2, 3, 4, 5, 6].map((day) => (
      <rect
        key={day}
        x={56 + day * 13}
        y={22}
        width={10}
        height={14}
        rx={3}
        className={day === 2 ? ACCENT : FAINT}
      />
    ))}
    {[45, 57, 69].map((y, index) => (
      <g key={y}>
        <Box x={56} y={y} done={index === 0} />
        <Bar x={70} y={y + 2} w={[52, 36, 44][index] ?? 40} />
      </g>
    ))}
  </Sheet>
);

/** Bills with their amounts, the next one to pay picked out, and the total. */
const bills = (
  <Sheet>
    {[24, 38, 52].map((y, index) => (
      <g key={y}>
        <Bar x={56} y={y} w={[44, 32, 50][index] ?? 40} />
        <Bar x={126} y={y} w={18} tone={index === 0 ? ACCENT : INK} />
      </g>
    ))}
    <path d="M56 65h88" strokeWidth={1} className={LINE} />
    <Bar x={56} y={72} w={22} tone={FAINT} />
    <rect x={118} y={71} width={26} height={6} rx={3} className="fill-muted-foreground/45" />
  </Sheet>
);

/** Week after week on one line, the latest check-in marked. */
const checkIns = (
  <Sheet>
    <Bar x={56} y={22} w={34} />
    <path d="M56 76h88" strokeWidth={1} className={LINE} />
    <path
      d="M58 64l14-8 14 5 14-15 14 4 14-13 12 4"
      strokeWidth={1.75}
      className="stroke-primary/45 [stroke-linecap:round] [stroke-linejoin:round]"
    />
    {[
      [58, 64],
      [72, 56],
      [86, 61],
      [100, 46],
      [114, 50],
      [128, 37],
    ].map(([cx, cy]) => (
      <circle key={cx} cx={cx} cy={cy} r={2} className="fill-background stroke-primary/60" />
    ))}
    <circle cx={140} cy={41} r={3.5} className={ACCENT} />
  </Sheet>
);

/** The house, and what comes due for it. */
const home = (
  <Sheet>
    <path d="M57 51l14-12 14 12M61 48v22h20V48" strokeWidth={1.5} className={LINE} />
    <rect x={68} y={58} width={6} height={12} rx={1} className={INK} />
    {[30, 50].map((y, index) => (
      <g key={y}>
        <rect x={98} y={y} width={12} height={12} rx={3} className={index === 0 ? ACCENT : FAINT} />
        <Bar x={115} y={y + 1} w={index === 0 ? 28 : 22} />
        <Bar x={115} y={y + 8} w={16} tone={FAINT} />
      </g>
    ))}
  </Sheet>
);

/** Applications and where each stands, with the follow-up drafted. */
const followUps = (
  <Sheet>
    {[23, 34, 45].map((y, index) => (
      <g key={y}>
        <circle cx={59} cy={y + 2} r={3} className={index === 1 ? ACCENT : INK} />
        <Bar x={68} y={y} w={[40, 52, 30][index] ?? 40} />
      </g>
    ))}
    <rect x={68} y={57} width={76} height={22} rx={6} className={ACCENT_TINT} />
    <Bar x={75} y={63} w={52} tone="fill-primary/60" />
    <Bar x={75} y={70} w={34} tone="fill-primary/35" />
  </Sheet>
);

/** The people you keep up with, one of them due a word. */
const people = (
  <Sheet>
    {[68, 100, 132].map((cx, index) => {
      const due = index === 1;
      return (
        <g key={cx}>
          <circle cx={cx} cy={38} r={11} className={due ? ACCENT_TINT : FAINT} />
          <circle cx={cx} cy={35} r={3.5} className={due ? ACCENT : INK} />
          <path d={`M${cx - 6} 45a6 5 0 0 1 12 0`} strokeWidth={0} className={due ? ACCENT : INK} />
          <Bar x={cx - 10} y={58} w={20} tone={due ? "fill-primary/60" : INK} />
          <Bar x={cx - 7} y={66} w={14} tone={FAINT} />
        </g>
      );
    })}
  </Sheet>
);

/** An older note pulled from the pile, with its place marked. */
const reread = (
  <>
    <rect
      x={46}
      y={11}
      width={108}
      height={78}
      rx={8}
      strokeWidth={1}
      transform="rotate(-5 100 50)"
      className="fill-background/50 stroke-border"
    />
    <rect
      x={46}
      y={11}
      width={108}
      height={78}
      rx={8}
      strokeWidth={1}
      transform="rotate(3.5 100 50)"
      className="fill-background/70 stroke-border"
    />
    <Sheet>
      <path d="M130 11v17l5-4 5 4V11z" className={ACCENT} />
      <Bar x={56} y={24} w={40} tone="fill-muted-foreground/45" />
      <Bar x={56} y={38} w={86} />
      <Bar x={56} y={47} w={74} />
      <Bar x={56} y={56} w={82} />
      <Bar x={56} y={65} w={50} />
    </Sheet>
  </>
);

/** A list of boxes: one done, the rest still waiting. */
const todos = (
  <Sheet>
    {[22, 37, 52, 67].map((y, index) => (
      <g key={y}>
        <Box x={57} y={y} done={index === 0} />
        <Bar x={72} y={y + 2} w={[48, 66, 38, 56][index] ?? 40} tone={index === 0 ? FAINT : INK} />
      </g>
    ))}
    <path d="M72 26h48" strokeWidth={1} className={LINE} />
  </Sheet>
);

/** An empty sheet with the cursor waiting. */
const own = (
  <Sheet dashed>
    <path d="M58 24v10" strokeWidth={1.75} className={ACCENT_LINE} />
    <Bar x={63} y={27} w={36} tone={FAINT} />
    <circle cx={100} cy={59} r={11} className={ACCENT_TINT} />
    <path d="M100 54v10M95 59h10" strokeWidth={1.75} className={ACCENT_LINE} />
  </Sheet>
);

/** A short message, for a routine this version has no drawing for. */
const message = (
  <Sheet>
    <Bar x={56} y={24} w={40} tone="fill-muted-foreground/45" />
    <Bar x={56} y={38} w={86} />
    <Bar x={56} y={47} w={70} />
    <Bar x={56} y={56} w={78} />
    <circle cx={136} cy={73} r={7} strokeWidth={1.5} className={ACCENT_LINE} />
    <path d="M136 69v4l3 2" strokeWidth={1.5} className={ACCENT_LINE} />
  </Sheet>
);

/** By the key the server gives a ready-made routine. */
const DRAWINGS: Readonly<Record<string, ReactNode>> = {
  "inbox-summary": reply,
  "prepare-tomorrow": tomorrow,
  "evening-journal": journal,
  "note-to-reread": reread,
  "todos-left-behind": todos,
  meals,
  money: bills,
  health: checkIns,
  home,
  "job-search": followUps,
  people,
  own,
};

/**
 * A small drawing of what a ready-made routine hands you; `own` is the blank one. Decoration:
 * the card's words say the same.
 */
export function RoutineDrawing({
  routine,
  className,
}: {
  readonly routine: string;
  readonly className?: string;
}) {
  return (
    <svg
      viewBox="0 0 200 100"
      // Lines are drawn, not filled; a shape that is filled says so with its own class.
      fill="none"
      aria-hidden
      data-routine-drawing={routine in DRAWINGS ? routine : "message"}
      className={cn("block h-auto w-full", className)}
    >
      {DRAWINGS[routine] ?? message}
    </svg>
  );
}
