import { describe, expect, it } from "vite-plus/test";

import { splitSentences } from "./sentences.ts";

describe("splitSentences", () => {
  it.each([
    [
      "plain sentences",
      "The build passed today. Should I release it? Yes, go ahead!",
      ["The build passed today.", "Should I release it?", "Yes, go ahead!"],
    ],
    [
      "French titles",
      "J'ai appelé M. Dupont et Mme Martin. Le Dr. Petit rappellera demain.",
      ["J'ai appelé M. Dupont et Mme Martin.", "Le Dr. Petit rappellera demain."],
    ],
    [
      "French punctuation spacing",
      "Tu viens demain ? Oui, bien sûr ! « On verra bien. » Elle a beaucoup ri.",
      ["Tu viens demain ?", "Oui, bien sûr !", "« On verra bien. »", "Elle a beaucoup ri."],
    ],
    [
      "abbreviations",
      "Use a tool, e.g. Vitest or p. ex. Jest, cf. Smith vs. Jones. That is all for now.",
      ["Use a tool, e.g. Vitest or p. ex. Jest, cf. Smith vs. Jones.", "That is all for now."],
    ],
    [
      "initials",
      "It was J. R. R. Tolkien in the U.S. Army. He wrote a lot.",
      ["It was J. R. R. Tolkien in the U.S. Army.", "He wrote a lot."],
    ],
    [
      "decimals and times",
      "Il mesure 3,5 m et pèse 3.5 kg à 10.30 ou 14:05. La suite arrive demain.",
      ["Il mesure 3,5 m et pèse 3.5 kg à 10.30 ou 14:05.", "La suite arrive demain."],
    ],
    [
      "a number that ends a sentence",
      "There are exactly 3. Then we stop there.",
      ["There are exactly 3.", "Then we stop there."],
    ],
    [
      "file names",
      "I saved it in notes.md and index.test.ts. Open notes.md. Then read it all.",
      ["I saved it in notes.md and index.test.ts.", "Open notes.md.", "Then read it all."],
    ],
    [
      "ellipses",
      "Well... maybe not today… or ever. Hmm… Let me think about it.",
      ["Well... maybe not today… or ever.", "Hmm… Let me think about it."],
    ],
    [
      "an unknown abbreviation before a lowercase word",
      "It took approx. five minutes to finish. Good enough.",
      ["It took approx. five minutes to finish.", "Good enough."],
    ],
    [
      "repeated marks and closing quotes",
      'She asked "Really?!" Then he said (quietly.) Nothing else happened.',
      ['She asked "Really?!"', "Then he said (quietly.)", "Nothing else happened."],
    ],
    [
      "paragraph breaks",
      "A heading without a mark\n\nA first paragraph\nover two lines\n\n\nThe last one.",
      ["A heading without a mark", "A first paragraph over two lines", "The last one."],
    ],
  ])("%s", (_name, text, expected) => {
    expect(splitSentences(text)).toEqual(expected);
  });

  it("merges short fragments forward, and a short last one backward", () => {
    expect(splitSentences("Oui. Je m'en occupe tout de suite. Non. Pas ici.")).toEqual([
      "Oui. Je m'en occupe tout de suite.",
      "Non. Pas ici.",
    ]);
    expect(splitSentences("The work is finished. Done.")).toEqual(["The work is finished. Done."]);
    expect(splitSentences("Eggs.\n\nMilk.\n\nBread.")).toEqual(["Eggs. Milk. Bread."]);
    expect(splitSentences("Ok.")).toEqual(["Ok."]);
  });

  it("returns nothing for blank text", () => {
    expect(splitSentences(" \n\n  ")).toEqual([]);
  });

  it("splits a long sentence at commas and semicolons", () => {
    const clause = "then the next step in the long list of steps is described here";
    const sentence = `First${`, ${clause}`.repeat(5)}; ${clause}, and it ends.`;
    const pieces = splitSentences(sentence);

    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join(" ")).toBe(sentence);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(300);
    for (const piece of pieces.slice(0, -1)) expect(piece).toMatch(/[,;]$/);
    for (const piece of pieces) expect(piece.length).toBeGreaterThanOrEqual(40);
  });

  it("splits a long sentence without commas at a space", () => {
    const sentence = `${"word ".repeat(100)}end.`;
    const pieces = splitSentences(sentence);

    expect(pieces.join(" ")).toBe(sentence);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(300);
  });
});
