import type { Checks } from "./grade.ts";

export interface Case {
  readonly id: string;
  /** Where the case comes from. */
  readonly source: string;
  readonly kind: "spoken" | "control";
  /** What the user said, as the transcript holds it. */
  readonly text: string;
  readonly spoken: boolean;
  readonly checks: Checks;
}

const TABLE_QUESTION =
  "Compare a 13 inch laptop, a 15 inch laptop and a tablet with a keyboard for someone who writes all day and travels twice a month. Weight, battery, screen and price.";

const SPOKEN: Checks = {
  noTable: true,
  noList: true,
  noHeading: true,
  noCode: true,
  maxWords: 110,
};

/** Written with the instruction (voice mode, 2026-11-27), so none has a failing baseline. */
export const cases: ReadonlyArray<Case> = [
  {
    id: "table-prone-question",
    source: "Voice mode plan: a comparison answered as a table cannot be read aloud.",
    kind: "spoken",
    text: TABLE_QUESTION,
    spoken: true,
    checks: SPOKEN,
  },
  {
    id: "routine-result",
    source: "Voice mode plan: a morning brief read aloud is a list of fifteen lines.",
    kind: "spoken",
    text: [
      "Give me my morning brief from what follows.",
      "",
      "Calendar today: 09:00 stand-up (15 min); 10:30 dentist, rue des Lilas; 12:15 lunch with Ana;",
      "14:00 call with the accountant about the VAT return; 16:30 school pick-up; 19:00 yoga.",
      "Tasks due: send the signed lease; renew the train card (expires Friday); book the car",
      "inspection; reply to Marc about the invoice; order printer ink.",
      "Mail overnight: 14 new, 3 need a reply (Marc, the school, the bank about a card renewal).",
      "Weather: 6 degrees, rain from 15:00.",
    ].join("\n"),
    spoken: true,
    checks: { ...SPOKEN, mentions: [{ pattern: "screen", label: "says the detail is on screen" }] },
  },
  {
    id: "code-request",
    source: "Voice mode plan: code read aloud is noise; it belongs on screen.",
    kind: "spoken",
    text: "How do I undo my last git commit but keep the changes?",
    spoken: true,
    checks: SPOKEN,
  },
  {
    id: "control-typed-question",
    source: "Control: the same question typed must still get its usual, structured answer.",
    kind: "control",
    text: TABLE_QUESTION,
    spoken: false,
    checks: { structured: true },
  },
];
