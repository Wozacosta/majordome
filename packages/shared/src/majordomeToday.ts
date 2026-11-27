/** What Today's box offers and says, the same on the computer and the phone. */

export type Greeting = "Good morning" | "Good afternoon" | "Good evening";

/** The greeting for an hour of the day (0-23); the small hours still read as the evening. */
export function greetingForHour(hour: number): Greeting {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * Ways in for someone facing Today's empty box. A whole request is sent as it is; the start of a
 * sentence waits in the box for the owner to finish it.
 */
export const TODAY_STARTERS = [
  { label: "Remember something", text: "Remember that ", send: false },
  { label: "Ask about my notes", text: "What do my notes say about ", send: false },
  { label: "Remind me", text: "Remind me to ", send: false },
  { label: "Plan my day", text: "Help me plan my day.", send: true },
] as const;

/**
 * What the box holds after a starter is pressed, and whether it is sent at once. A starter fills
 * an empty box or replaces another starter; words the owner typed stay, after it, and are theirs
 * to send.
 */
export function pickTodayStarter(
  typed: string,
  starter: (typeof TODAY_STARTERS)[number],
): { readonly text: string; readonly send: boolean } {
  const untouched =
    typed.trim() === "" ||
    TODAY_STARTERS.some((candidate) => candidate.text.trim() === typed.trim());
  if (untouched) return { text: starter.text, send: starter.send };
  // A whole sentence needs a space before the owner's own words.
  const lead = starter.text.endsWith(" ") ? starter.text : `${starter.text} `;
  return { text: `${lead}${typed}`, send: false };
}
