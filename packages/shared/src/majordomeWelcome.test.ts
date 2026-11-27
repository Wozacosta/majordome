import { describe, expect, it } from "vite-plus/test";

import { welcomeCards } from "./majordomeWelcome.ts";

describe("welcomeCards", () => {
  it("asks for a name first when the notes have none", () => {
    expect(welcomeCards(null).map((card) => card.key)).toEqual([
      "name",
      "tell",
      "topics",
      "routines",
    ]);
  });

  it("greets by name and skips the question when the notes already have one", () => {
    const cards = welcomeCards("Ana");
    expect(cards.map((card) => card.key)).toEqual(["tell", "topics", "routines"]);
    expect(cards[0]?.title).toBe("Welcome, Ana. Tell me anything");
  });
});
