import { hashSource } from "generaltranslation/id";
import { describe, expect, it } from "vite-plus/test";

import { rebrandCatalog, renamedKeys } from "./majordomeBrand";

const key = (source: string) => hashSource({ source, dataFormat: "ICU" });

describe("majordomeBrand", () => {
  it("keeps a translation findable once its English text names Majordome", () => {
    const english = {
      [key("Restart T3 Code")]: "Restart T3 Code",
      [key("Open")]: "Open",
      // Hashed with a context the catalog does not record.
      withContext: "T3 Code link",
    };
    const keys = renamedKeys(english);
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
});
