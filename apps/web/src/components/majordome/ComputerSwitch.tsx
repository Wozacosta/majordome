import { useState } from "react";

import { Toggle, ToggleGroup } from "../ui/toggle-group";

export interface ComputerChoice {
  readonly id: string;
  readonly label: string;
  /** Something on it waits for the owner, so it is marked before they switch to it. */
  readonly needsYou?: boolean;
}

/** Which of a page's computers is shown: the one picked, or the first while none is. */
export function useShownComputer<T extends { readonly id: string }>(choices: readonly T[]) {
  const [picked, setPicked] = useState<string | null>(null);
  const shown = choices.find((choice) => choice.id === picked) ?? choices[0] ?? null;
  return [shown, setPicked] as const;
}

/**
 * Under a page's title, where each computer has the same sections: the page shows one computer
 * at a time instead of repeating itself down the screen.
 */
export function ComputerSwitch({
  choices,
  shownId,
  onShow,
}: {
  readonly choices: readonly ComputerChoice[];
  readonly shownId: string | null;
  readonly onShow: (id: string) => void;
}) {
  if (choices.length < 2) return null;
  return (
    <div className="mt-5" data-computer-switch>
      <ToggleGroup
        aria-label="Computer"
        value={shownId === null ? [] : [shownId]}
        onValueChange={(next) => {
          const id = next[0];
          if (typeof id === "string") onShow(id);
        }}
      >
        {choices.map((choice) => (
          <Toggle key={choice.id} value={choice.id}>
            {choice.needsYou ? (
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
            ) : null}
            {choice.label}
            {choice.needsYou ? <span className="sr-only">, needs you</span> : null}
          </Toggle>
        ))}
      </ToggleGroup>
    </div>
  );
}
