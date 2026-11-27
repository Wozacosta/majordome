import { assert, describe, it } from "@effect/vitest";

import { aboutUserSection, meTemplate } from "./meNote.ts";

describe("the note about the owner", () => {
  it("starts with every heading and no fact when nothing was said at setup", () => {
    const template = meTemplate();
    assert.deepStrictEqual(
      template.split("\n").filter((line) => line.startsWith("## ")),
      [
        "## Me",
        "## Contact",
        "## Work",
        "## Identity documents",
        "## Money",
        "## Household",
        "## Emergency contact",
      ],
    );
    assert.notInclude(template, "- Name:");
    assert.include(aboutUserSection({ path: "me.md", text: template }), "are empty so far");
  });

  it("keeps a language tag it cannot name, and drops blank answers", () => {
    const template = meTemplate({ name: "   ", language: "not a tag", timeZone: "" });
    assert.include(template, "## Me\n- Language: not a tag\n\n## Contact");
  });

  it("loads the two first parts whatever the case of their headings, and cuts a long one", () => {
    const text = [
      "## ME",
      "- Name: Ana",
      "## Notes to self",
      "- Not loaded",
      "## contact",
      ...Array.from({ length: 200 }, (_, index) => `- Email ${index}: ana${index}@example.com`),
    ].join("\n");
    const section = aboutUserSection({ path: "me.md", text });
    assert.include(section, "## Me\n- Name: Ana\n## Contact\n- Email 0: ana0@example.com");
    assert.notInclude(section, "Not loaded");
    assert.include(section, "[Cut here: read the file for the rest.]");
    assert.isBelow(section.length, 3_500);
  });
});
