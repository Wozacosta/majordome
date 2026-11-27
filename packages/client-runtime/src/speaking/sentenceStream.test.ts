import { describe, expect, it } from "vite-plus/test";

import { createSentenceStream } from "./sentenceStream.ts";
import { splitSentences } from "./sentences.ts";
import { toSpeakableText } from "./speakableText.ts";

const CODE = "There is code on screen.";
const TABLE = "There is a table on screen.";

function streamInChunks(markdown: string, size: number) {
  const stream = createSentenceStream();
  const pushed: string[] = [];
  for (let at = 0; at < markdown.length; at += size) {
    pushed.push(...stream.push(markdown.slice(at, at + size)));
  }
  return { pushed, flushed: stream.flush() };
}

const REPLIES = {
  english: [
    "## What I did",
    "",
    "I updated **the notes. They** now list [the plan. See it](https://example.com/a.b) here.",
    "Run `vp test. Then` check notes.md. It costs 3.5 euros, e.g. at 10:30.",
    "",
    "```ts",
    "const done = true. Not a sentence.",
    "",
    "| not | a table |",
    "```",
    "",
    "~~~sh",
    "vp check",
    "~~~",
    "After the code, a table follows here.",
    "",
    "| File | Lines |",
    "| ---- | ----- |",
    "| a.ts | 12. A |",
    "",
    "- First item is here",
    "- *Second* item. It has two sentences",
    "- Third",
    "",
    "1. Numbered point",
    "",
    "    More on the numbered point.",
    "",
    "Done :tada: for now. Anything else you would like me to do?",
  ].join("\n"),
  french: [
    "# Résumé",
    "",
    "J'ai vu M. Dupont à 14:05... il viendra demain. Mme Martin aussi !",
    "Le fichier `budget.md` est à jour ; le total est de 3,5 k€.",
    "",
    "> Citation : « Tout va bien. » Rien d'autre.",
    "",
    "Mois | Total",
    "--- | ---",
    "Mai | 12",
    "Voilà pour le tableau. Autre chose ?",
    "",
    "Oui.",
    "",
    "Non.",
    "",
    "Voir https://example.com/page.html. C'est terminé pour aujourd'hui.",
  ].join("\n"),
  codeOnly: "```\nplain\n```",
  unclosed: "Before the code block starts.\n\n```js\nconst a = 1;\nstill code. Really.",
  vanishingImage:
    "Hello there my friend. ![a chart. Really](a.png) and so it goes on. Then the end of it!",
  strayMarks: "A stray * star. Then 2 < 3 and a [bracket. Still going. The end of it.",
};

describe("createSentenceStream", () => {
  it.each(Object.entries(REPLIES))(
    "says the same words as reading %s aloud, however it is cut",
    (_name, markdown) => {
      const expected = splitSentences(toSpeakableText(markdown));
      for (const size of [1, 2, 3, 5, 7, 11, 17, 40, markdown.length]) {
        const { pushed, flushed } = streamInChunks(markdown, size);
        const all = [...pushed, ...flushed];
        expect(all.join(" "), `chunks of ${size}`).toBe(expected.join(" "));
        expect(pushed, `chunks of ${size}`).toEqual(expected.slice(0, pushed.length));
      }
    },
  );

  it("returns each sentence as soon as the next one has begun", () => {
    const stream = createSentenceStream();

    expect(stream.push("The first sentence is do")).toEqual([]);
    expect(stream.push("ne. ")).toEqual([]);
    expect(stream.push("The sec")).toEqual(["The first sentence is done."]);
    expect(stream.push("ond one is too. And a thi")).toEqual(["The second one is too."]);
    expect(stream.push("rd.")).toEqual([]);
    expect(stream.push("\n\n")).toEqual(["And a third."]);
    expect(stream.flush()).toEqual([]);
  });

  it("holds a short sentence until it can join the next", () => {
    const stream = createSentenceStream();

    expect(stream.push("Oui.\n\nJe m'en occupe")).toEqual([]);
    expect(stream.push(" maintenant. Autre")).toEqual(["Oui. Je m'en occupe maintenant."]);
    expect(stream.flush()).toEqual(["Autre."]);
  });

  it("waits for a code block to close, and says its line once", () => {
    const stream = createSentenceStream();

    expect(stream.push("Here is the script:\n\n``")).toEqual(["Here is the script:"]);
    expect(stream.push("`sh\necho one. Two")).toEqual([]);
    expect(stream.push("\n\necho three.\n``")).toEqual([]);
    expect(stream.push("`\n")).toEqual([CODE]);
    expect(stream.push("\n```sh\nmore\n```\n\nAll done here.\n\n")).toEqual(["All done here."]);
    expect(stream.flush()).toEqual([]);
  });

  it("waits for a table to end", () => {
    const stream = createSentenceStream();

    expect(stream.push("The numbers are below.\n\n| Mon")).toEqual(["The numbers are below."]);
    expect(stream.push("th | Total |\n| --- | -")).toEqual([]);
    expect(stream.push("-- |\n| May. Jun | 3 |\n")).toEqual([]);
    expect(stream.push("| Jul | 4 |\n\nThat")).toEqual([TABLE]);
    expect(stream.flush()).toEqual(["That."]);
  });

  it("does not say half a link or half a bold phrase", () => {
    const stream = createSentenceStream();

    expect(stream.push("Read [the guide. It is long](https://exam")).toEqual([]);
    expect(stream.push("ple.com) first. Then **stop. Rea")).toEqual([
      "Read the guide.",
      "It is long first.",
    ]);
    expect(stream.push("lly** stop. And rest.")).toEqual(["Then stop. Really stop."]);
    expect(stream.flush()).toEqual(["And rest."]);
  });

  it("uses the lines it is given", () => {
    const stream = createSentenceStream({ codeLine: "Il y a du code à l'écran." });

    expect(stream.push("```\nx\n```\n")).toEqual(["Il y a du code à l'écran."]);
  });

  it("starts again after a flush", () => {
    const stream = createSentenceStream();
    stream.push("One reply that was cut sho");

    expect(stream.flush()).toEqual(["One reply that was cut sho."]);
    expect(stream.push("A second reply begins. It")).toEqual(["A second reply begins."]);
    expect(stream.flush()).toEqual(["It."]);
  });
});
