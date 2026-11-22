import { cn } from "~/lib/utils";

/** A quiet line across the chat naming a day, or marking what arrived while the person was away. */
export function TimelineDayDivider(props: { readonly label: string; readonly unread: boolean }) {
  const line = cn("h-px flex-1", props.unread ? "bg-primary/40" : "bg-border/50");
  return (
    <div
      role="separator"
      aria-label={props.label}
      className={cn(
        "flex items-center gap-3 px-1 py-1 text-xs",
        props.unread ? "font-medium text-primary" : "text-muted-foreground",
      )}
    >
      <span aria-hidden="true" className={line} />
      <span>{props.label}</span>
      <span aria-hidden="true" className={line} />
    </div>
  );
}
