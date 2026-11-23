// Upstream's coding words inside a sentence, said Majordome's way. Applied to the phone's English
// texts of two words or more; a single word may also be a route or screen name, so those are
// listed one by one in wording.mts.
const RULES = [
  [/\bun-settled\b/g, "brought back"],
  [/\b[Uu]n-?settle\b/g, (word) => (word[0] === "U" ? "Bring back" : "bring back")],
  [/\bundo settle\b/g, "undo marking as done"],
  [/\bbe settled\b/g, "be marked as done"],
  [/\bon settle\b/g, "when marked as done"],
  [/\bauto-settle\b/g, "auto-done"],
  [/\bAuto-settle\b/g, "Auto-done"],
  [/\bsettled\b/g, "done"],
  [/\bSettled\b/g, "Done"],
  [/\bsettle\b/g, "mark as done"],
  [/\bSettle\b/g, "Mark as done"],
  [/\bcoding sessions?\b/g, "chats"],
  [/\bthread\b/g, "chat"],
  [/\bthreads\b/g, "chats"],
  [/\bThread\b/g, "Chat"],
  [/\bThreads\b/g, "Chats"],
  [/\ban environment\b/g, "a computer"],
  [/\bAn environment\b/g, "A computer"],
  [/\bthe environment\b/g, "your computer"],
  [/\bThe environment\b/g, "Your computer"],
  [/\benvironment\b/g, "computer"],
  [/\benvironments\b/g, "computers"],
  [/\bEnvironment\b/g, "Computer"],
  [/\bEnvironments\b/g, "Computers"],
];

/** `text` with the rules applied outside its `{placeholders}`, whose names code refers to. */
function majordomeWords(text) {
  return text
    .split(/(\{[A-Za-z_][\w]*(?=[},]))/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : RULES.reduce((next, [pattern, word]) => next.replace(pattern, word), part),
    )
    .join("");
}

module.exports = { majordomeWords };
