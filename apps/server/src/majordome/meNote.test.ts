import { assert, describe, it } from "@effect/vitest";

import { aboutUserSection, meTemplate, ownerName, withOwnerName } from "./meNote.ts";

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

  it("reads and writes the owner's name, whatever state the note is in", () => {
    assert.isNull(ownerName(null));
    assert.isNull(ownerName(meTemplate()));
    // No note yet: the template, with the name in it.
    const started = withOwnerName(null, "  Ana   Costa ");
    assert.include(started, "## Me\n- Name: Ana Costa\n\n## Contact");
    assert.equal(ownerName(started), "Ana Costa");
    // A name already there is replaced, and nothing else moves.
    assert.equal(withOwnerName(started, "Ana"), started.replace("Ana Costa", "Ana"));
    // A note with lines but no name gets it first under Me.
    assert.equal(
      withOwnerName("# About me\n\n## Me\n- Language: French\n\n## Contact\n", "Ana"),
      "# About me\n\n## Me\n- Name: Ana\n- Language: French\n\n## Contact\n",
    );
    // A hand-written note without the heading keeps its text.
    assert.equal(
      withOwnerName("I live in Lyon.\n", "Ana"),
      "I live in Lyon.\n\n## Me\n- Name: Ana\n",
    );
  });
});
