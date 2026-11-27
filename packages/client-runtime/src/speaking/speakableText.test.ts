import { describe, expect, it } from "vite-plus/test";

import { toSpeakableText } from "./speakableText.ts";

const CODE = "There is code on screen.";
const TABLE = "There is a table on screen.";

describe("toSpeakableText", () => {
  it.each([
    ["heading", "## Next steps", "Next steps."],
    ["closed heading", "# Plan #", "Plan."],
    [
      "bold and italic",
      "This is **very** *important* and __really__ _so_.",
      "This is very important and really so.",
    ],
    [
      "nested emphasis",
      "***All of it*** and **some *inner* text**.",
      "All of it and some inner text.",
    ],
    ["strikethrough", "It is ~~wrong~~ right.", "It is wrong right."],
    ["snake case survives", "Set max_retry_count to 3.", "Set max_retry_count to 3."],
    ["arithmetic survives", "2 * 3 * 4 is 24.", "2 * 3 * 4 is 24."],
    ["inline code keeps its text", "Run `vp test` then `a_b_c`.", "Run vp test then a_b_c."],
    ["double backtick code", "Use ``a ` b`` here.", "Use a ` b here."],
    [
      "link keeps its text",
      "See [the guide](https://example.com/a_(b)) now.",
      "See the guide now.",
    ],
    ["link with a title", 'See [the guide](https://example.com "Guide").', "See the guide."],
    ["reference link", "See [the guide][1] now.", "See the guide now."],
    ["link whose text is a URL", "[https://example.com](https://example.com)", "a link."],
    ["bare URL", "Go to https://example.com/x?y=1.", "Go to a link."],
    ["www URL in brackets", "It is there (www.example.com).", "It is there (a link)."],
    ["autolink", "Write to <https://example.com>.", "Write to a link."],
    ["image", "Before ![a chart](chart.png) after.", "Before after."],
    ["image alone", "![a chart](chart.png)", ""],
    ["linked image", "[![badge](b.svg)](https://ci.example.com)", ""],
    ["footnote mark", "It works[^1] well.[^note]", "It works well."],
    [
      "html tags",
      "A <b>bold</b> move<br/>here <span class='x'>now</span>.",
      "A bold move here now.",
    ],
    ["html comment", "Shown <!-- hidden --> text.", "Shown text."],
    ["emoji shortcode", "Done :tada: and :+1: too.", "Done and too."],
    ["times are not shortcodes", "At 10:30:45 or a:b:c.", "At 10:30:45 or a:b:c."],
    ["escaped marks", "A \\*literal\\* star and 1\\. item", "A *literal* star and 1. item."],
    ["entities", "Tom &amp; Jerry &lt;3", "Tom & Jerry <3."],
    ["block quote", "> Quoted **words**\n> go on.", "Quoted words go on."],
    ["callout", "> [!NOTE]\n> Mind the gap.", "Mind the gap."],
    ["rule", "Above.\n\n---\n\nBelow.", "Above.\n\nBelow."],
    ["setext heading", "Title\n=====\n\nBody.", "Title.\n\nBody."],
    ["soft line breaks join", "One line\nand another.", "One line and another."],
    ["unclosed marks are dropped", "A **bold start", "A bold start."],
  ])("%s", (_name, markdown, expected) => {
    expect(toSpeakableText(markdown)).toBe(expected);
  });

  it("turns list items into sentences", () => {
    const markdown = [
      "Courses :",
      "",
      "- des œufs",
      "- du **lait** entier ;",
      "  bio si possible",
      "1. [x] Payer le loyer",
      "2) Appeler Mme Durand !",
    ].join("\n");
    expect(toSpeakableText(markdown)).toBe(
      [
        "Courses :",
        "des œufs.",
        "du lait entier ; bio si possible.",
        "Payer le loyer.",
        "Appeler Mme Durand !",
      ].join("\n\n"),
    );
  });

  it("does not take a year at the start of a line for a list number", () => {
    expect(toSpeakableText("It began in\n2024. That was late.")).toBe(
      "It began in 2024. That was late.",
    );
  });

  it("says one line for each run of code blocks", () => {
    const markdown = [
      "Run this:",
      "```sh",
      "vp test # not a heading",
      "| not | a table |",
      "```",
      "",
      "~~~ts",
      "const a = 1;",
      "~~~",
      "",
      "Then this:",
      "",
      "    indented code",
      "",
      "    more of it",
      "",
      "Done.",
    ].join("\n");
    expect(toSpeakableText(markdown)).toBe(
      ["Run this:", CODE, "Then this:", CODE, "Done."].join("\n\n"),
    );
  });

  it("keeps a longer fence open until it is matched", () => {
    const markdown = "````md\n```js\ncode\n```\nstill code\n````\nAfter.";
    expect(toSpeakableText(markdown)).toBe(`${CODE}\n\nAfter.`);
  });

  it("drops an unclosed fence to the end", () => {
    expect(toSpeakableText("Before.\n\n```js\nconst a = 1;")).toBe(`Before.\n\n${CODE}`);
  });

  it("does not treat indented list text as code", () => {
    const markdown = "1. First point\n\n    More on the first point.\n\n2. Second point";
    expect(toSpeakableText(markdown)).toBe(
      "First point.\n\nMore on the first point.\n\nSecond point.",
    );
  });

  it("says one line for a table, and for tables in a row", () => {
    const markdown = [
      "Voici les chiffres.",
      "",
      "| Mois | Total |",
      "| :--- | ----: |",
      "| Mai  | 3,5   |",
      "",
      "Nom | Âge",
      "--- | ---",
      "Léa | 31",
      "Et voilà.",
    ].join("\n");
    expect(toSpeakableText(markdown)).toBe(
      ["Voici les chiffres.", TABLE, "Et voilà."].join("\n\n"),
    );
  });

  it("keeps a line with a pipe that is not a table", () => {
    expect(toSpeakableText("Use a | b to pipe.")).toBe("Use a | b to pipe.");
  });

  it("says code and a table separately", () => {
    expect(toSpeakableText("```\nx\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |")).toBe(
      `${CODE}\n\n${TABLE}`,
    );
  });

  it("uses the lines it is given", () => {
    const options = {
      codeLine: "Il y a du code à l'écran.",
      tableLine: "Il y a un tableau à l'écran.",
      linkWord: "un lien",
    };
    expect(
      toSpeakableText("```\nx\n```\n\n| a |\n|---|\n\nVoir https://example.com", options),
    ).toBe("Il y a du code à l'écran.\n\nIl y a un tableau à l'écran.\n\nVoir un lien.");
  });

  it("drops link and footnote definitions", () => {
    expect(toSpeakableText("See [it][1].\n\n[1]: https://example.com\n[^a]: A note.")).toBe(
      "See it.",
    );
  });

  it("reads Windows line endings", () => {
    expect(toSpeakableText("# Title\r\n\r\nBody text.\r\n")).toBe("Title.\n\nBody text.");
  });
});
