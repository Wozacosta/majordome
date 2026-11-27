import { useAtomValue } from "@effect/atom-react";
import { MAJORDOME_OWNER_NAME_MAX } from "@t3tools/contracts";
import {
  WELCOME_DONE_LABEL,
  WELCOME_NAME_PLACEHOLDER,
  WELCOME_NEXT_LABEL,
  WELCOME_SKIP_LABEL,
  welcomeCards,
} from "@t3tools/shared/majordomeWelcome";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import type { MajordomeVault } from "./topics.logic";

/**
 * The welcome of a new notes folder: what to call its owner, then three cards on how Majordome
 * works. It floats over Today until finished or skipped, once per folder whichever device asks.
 */
export function TodayWelcome({ vault }: { readonly vault: MajordomeVault }) {
  const { environmentId, projectId } = vault;
  const welcome = AsyncResult.getOrElse(
    useAtomValue(majordomeEnvironment.welcome({ environmentId, input: { projectId } })),
    () => null,
  );
  const finish = useAtomCommand(majordomeEnvironment.finishWelcome, {
    label: "save your name",
  });
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [left, setLeft] = useState(false);
  if (welcome === null || !welcome.pending || left) return null;

  const cards = welcomeCards(welcome.name);
  const card = cards[Math.min(step, cards.length - 1)];
  if (card === undefined) return null;
  const last = step >= cards.length - 1;
  const end = () => {
    setLeft(true);
    void finish({ environmentId, input: { projectId, name: name.trim() === "" ? null : name } });
  };
  const next = () => (last ? end() : setStep(step + 1));

  return (
    <section
      aria-label="Welcome"
      className="absolute inset-x-4 bottom-5 z-20 mx-auto w-auto max-w-sm rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-lg"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          next();
        }}
      >
        <h2 className="text-sm font-semibold text-foreground">{card.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{card.body}</p>
        {card.key === "name" ? (
          <div className="mt-3">
            <Input
              autoFocus
              aria-label={card.title}
              placeholder={WELCOME_NAME_PLACEHOLDER}
              autoComplete="given-name"
              maxLength={MAJORDOME_OWNER_NAME_MAX}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </div>
        ) : null}
        <div className="mt-4 flex items-center gap-2">
          <ol
            className="flex flex-1 items-center gap-1.5"
            aria-label={`Step ${step + 1} of ${cards.length}`}
          >
            {cards.map((each, index) => (
              <li
                key={each.key}
                className={cn(
                  "size-1.5 rounded-full",
                  index === step ? "bg-primary" : "bg-muted-foreground/30",
                )}
              />
            ))}
          </ol>
          {last ? null : (
            <Button type="button" size="sm" variant="ghost-muted" onClick={end}>
              {WELCOME_SKIP_LABEL}
            </Button>
          )}
          <Button type="submit" size="sm">
            {last ? WELCOME_DONE_LABEL : WELCOME_NEXT_LABEL}
          </Button>
        </div>
      </form>
    </section>
  );
}
