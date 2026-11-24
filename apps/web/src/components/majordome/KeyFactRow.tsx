import type { MajordomeKeyFactKind } from "@t3tools/contracts";
import { CalendarIcon, LinkIcon, type LucideIcon, MapPinIcon, UserIcon } from "lucide-react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "../chat/threadDetailsPanelStyles";
import { toastManager } from "../ui/toast";
import type { KeyFactRow } from "./keyFacts.logic";

const ICONS: Record<MajordomeKeyFactKind, LucideIcon> = {
  link: LinkIcon,
  place: MapPinIcon,
  date: CalendarIcon,
  person: UserIcon,
};

/** Rows of key facts. A link opens; anything else is copied. */
export function KeyFactRows({
  label,
  rows,
}: {
  readonly label: string;
  readonly rows: ReadonlyArray<KeyFactRow>;
}) {
  const { copyToClipboard } = useCopyToClipboard<string>({
    onCopy: (value) => toastManager.add({ type: "success", title: "Copied", description: value }),
  });
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col p-0">
      {rows.map((fact) => {
        const Icon = ICONS[fact.kind];
        return (
          <li key={fact.key} className="flex min-w-0">
            <ThreadDetailsControl
              size="xs"
              variant="ghost"
              part="row"
              panel
              multiline={fact.detail !== null}
              title={fact.href === null ? `Copy ${fact.value}` : fact.value}
              {...(fact.href === null
                ? { onClick: () => copyToClipboard(fact.value, fact.value) }
                : { render: <a href={fact.href} target="_blank" rel="noreferrer" /> })}
            >
              <Icon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                <span className="truncate">{fact.label}</span>
                {fact.detail === null ? null : (
                  <span className="truncate text-xs font-normal text-muted-foreground">
                    {fact.detail}
                  </span>
                )}
              </span>
            </ThreadDetailsControl>
          </li>
        );
      })}
    </ul>
  );
}
