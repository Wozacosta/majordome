// Upstream's coding words inside a sentence, said Majordome's way, first match first. Applied to the phone's English
// texts of two words or more; a single word may also be a route or screen name, so those are
// listed one by one in wording.mts.
const RULES = [
  [/\bun-?settle thread\b/g, "bring the chat back"],
  [/\bsettle thread\b/g, "mark the chat as done"],
  [/\bun-settled\b/g, "brought back"],
  [/\b[Uu]n-?settle\b/g, (word) => (word[0] === "U" ? "Bring back" : "bring back")],
  [/\bundo settle\b/g, "undo marking as done"],
  [/\bbe settled\b/g, "be marked as done"],
  [/\bon settle\b/g, "when marked as done"],
  [/\bauto-settle\b/g, "auto-done"],
  [/\bAuto-settle\b/g, "Auto-done"],
  [/\bsettling\b/g, "marking as done"],
  [/\bsettled\b/g, "done"],
  [/\bSettled\b/g, "Done"],
  [/\bsettle\b/g, "mark as done"],
  [/\bSettle\b/g, "Mark as done"],
  [/\bcoding sessions?\b/g, "chats"],
  [/\b([Aa]) scheduled task\b/g, "$1 routine"],
  [/\bscheduled task(s?)\b/g, "routine$1"],
  [/\bScheduled task(s?)\b/g, "Routine$1"],
  [/\bdeletes this task\b/g, "deletes this routine"],
  [/\bthe new task composer\b/g, "a new chat"],
  [/\bnew task\b/g, "new chat"],
  [/\bNew task\b/g, "New chat"],
  [/\b([Ss])tart a task\b/g, "$1tart a chat"],
  [/\bcreating a task\b/g, "starting a chat"],
  [/\bthe composer\b/g, "the message box"],
  [/\bthe environment's machine\b/g, "your computer"],
  [/\bmachine(s?)\b/g, "computer$1"],
  [/\bMachine(s?)\b/g, "Computer$1"],
  [/\benvironment servers\b/g, "computers"],
  [/\bthe environment endpoint\b/g, "your computer"],
  [/\bThe environment endpoint\b/g, "Your computer"],
  [/\benvironment endpoint\b/g, "computer"],
  [/\b([Tt])he environment(?= (?:request|connection request|link proof)\b)/g, "$1he computer"],
  [/\bin this environment\b/g, "on this computer"],
  [/\bon the server host\b/g, "on your computer"],
  [/\bThis environment's server\b/g, "Majordome on this computer"],
  [/\bUpdate the server\b/g, "Update it there"],
  [/\b(on|by) the server\b/g, "$1 your computer"],
  [/\bThe server\b/g, "Your computer"],
  [/\bthis server\b/g, "this computer"],
  [/\bthe host\b/g, "your computer"],
  [/\bThe host\b/g, "Your computer"],
  [/\b([Aa]) route\b/g, "$1n address"],
  [/\broute(s?)\b/g, "address$1"],
  [/\bRoute(s?)\b/g, "Address$1"],
  [/\baddresss\b/g, "addresses"],
  [/\bAddresss\b/g, "Addresses"],
  [/\bagents work\b/g, "the assistant works"],
  [/\bAllow agents\b/g, "Allow the assistant"],
  [/\b(?:the|an|this) agent\b/g, "the assistant"],
  [/\b(?:The|An|This) agent\b/g, "The assistant"],
  [/\bagent(s?)\b/g, "assistant$1"],
  [/\bAgent(s?)\b/g, "Assistant$1"],
  // A source control provider is a code host, on screens Majordome never shows.
  [/(?<!source control |Source control |Git |hosting )\b([Aa]) provider\b/g, "$1n AI account"],
  [/(?<!source control |Source control |Git |hosting )\bprovider(s?)\b/g, "AI account$1"],
  [/(?<!source control |Source control |Git |hosting )\bProvider(s?)\b/g, "AI account$1"],
  [/\b([Aa]) project\b/g, "$1 notes folder"],
  [/\bproject(s?)\b/g, "notes folder$1"],
  [/\bProject(s?)\b/g, "Notes folder$1"],
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

const reworded = (part) =>
  RULES.reduce((next, [pattern, word]) => next.replace(pattern, word), part);

/**
 * `text` with the rules applied to what is read. Inside an ICU argument (`{environment}`,
 * `{count, plural, one {…}}`) the name and the keywords are code; the texts nested in it are read.
 */
function majordomeWords(text) {
  let depth = 0;
  let start = 0;
  let next = "";
  const flush = (end) => {
    const part = text.slice(start, end);
    next += depth % 2 === 0 ? reworded(part) : part;
    start = end;
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") {
      flush(index);
      depth += 1;
    } else if (char === "}" && depth > 0) {
      flush(index);
      depth -= 1;
    }
  }
  flush(text.length);
  return next;
}

module.exports = { majordomeWords };
