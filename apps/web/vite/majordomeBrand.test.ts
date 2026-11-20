import { hashSource } from "generaltranslation/id";
import { describe, expect, it } from "vite-plus/test";

import { rebrandCatalog, renamedKeys, rewordSource } from "./majordomeBrand";

const key = (source: string) => hashSource({ source, dataFormat: "ICU" });

describe("majordomeBrand", () => {
  it("keeps a translation findable once its English text names Majordome", () => {
    const english = {
      [key("Restart T3 Code")]: "Restart T3 Code",
      [key("Open")]: "Open",
      // Hashed with a context the catalog does not record.
      withContext: "T3 Code link",
    };
    const keys = renamedKeys(english, new Map());
    expect([...keys]).toEqual([[key("Restart T3 Code"), key("Restart Majordome")]]);

    const french = rebrandCatalog(
      {
        [key("Restart T3 Code")]: "Redémarrer T3 Code",
        [key("Open")]: "Ouvrir",
        withContext: "Lien T3 Code",
      },
      keys,
    );
    expect(french[key("Restart Majordome")]).toBe("Redémarrer Majordome");
    expect(french[key("Open")]).toBe("Ouvrir");
    expect(french.withContext).toBe("Lien Majordome");
  });

  it("says a whole text Majordome's way and leaves longer texts holding it alone", () => {
    const wording = new Map([
      ["Rename thread", "Rename chat"],
      ['Delete "{title}" in T3 Code?', 'Delete the chat "{title}"?'],
    ]);
    expect(
      rewordSource(
        [
          'msg("Rename thread")',
          "<T>\n  Rename\n  thread\n</T>",
          'gt("Rename thread and project")',
          'gt("Delete \\"{title}\\" in T3 Code?")',
        ].join("\n"),
        wording,
      ),
    ).toBe(
      [
        'msg("Rename chat")',
        "<T>\n  Rename chat\n</T>",
        'gt("Rename thread and project")',
        'gt("Delete the chat \\"{title}\\"?")',
      ].join("\n"),
    );

    const english = { [key("Rename thread")]: "Rename thread" };
    const keys = renamedKeys(english, wording);
    const french = rebrandCatalog({ [key("Rename thread")]: "Renommer le fil" }, keys);
    expect(french[key("Rename chat")]).toBe("Renommer le fil");
  });
});
