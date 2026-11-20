import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  MAJORDOME_TOPIC_ICONS,
  type MajordomeTopic,
  type MajordomeTopicIcon,
} from "@t3tools/contracts";
import {
  BitcoinIcon,
  BookOpenIcon,
  BriefcaseIcon,
  CarIcon,
  CodeIcon,
  DumbbellIcon,
  FootprintsIcon,
  HashIcon,
  HeartPulseIcon,
  HouseIcon,
  LanguagesIcon,
  LeafIcon,
  LightbulbIcon,
  type LucideIcon,
  MusicIcon,
  PenLineIcon,
  PlaneIcon,
  ReceiptIcon,
  UsersIcon,
  UtensilsIcon,
  WalletIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { autoTopicIcon, topicIcon, topicTone, type TopicTone } from "./topicIcons.logic";
import type { MajordomeVault } from "./topics.logic";

const ICONS: Record<MajordomeTopicIcon, { readonly Icon: LucideIcon; readonly label: string }> = {
  hash: { Icon: HashIcon, label: "Topic" },
  dumbbell: { Icon: DumbbellIcon, label: "Fitness" },
  footprints: { Icon: FootprintsIcon, label: "Running and walking" },
  wallet: { Icon: WalletIcon, label: "Money" },
  receipt: { Icon: ReceiptIcon, label: "Accounting and taxes" },
  bitcoin: { Icon: BitcoinIcon, label: "Crypto" },
  plane: { Icon: PlaneIcon, label: "Travel" },
  "heart-pulse": { Icon: HeartPulseIcon, label: "Health" },
  "book-open": { Icon: BookOpenIcon, label: "Learning" },
  languages: { Icon: LanguagesIcon, label: "Languages" },
  briefcase: { Icon: BriefcaseIcon, label: "Work" },
  home: { Icon: HouseIcon, label: "Home" },
  utensils: { Icon: UtensilsIcon, label: "Food" },
  music: { Icon: MusicIcon, label: "Music" },
  code: { Icon: CodeIcon, label: "Code" },
  "pen-line": { Icon: PenLineIcon, label: "Writing" },
  users: { Icon: UsersIcon, label: "People" },
  leaf: { Icon: LeafIcon, label: "Nature" },
  car: { Icon: CarIcon, label: "Car" },
  lightbulb: { Icon: LightbulbIcon, label: "Ideas" },
};

/** Each tone as a tinted tile for the icon, and a lighter tint for the open topic's row. */
const TONES: Record<TopicTone, { readonly tile: string; readonly row: string }> = {
  amber: {
    tile: "bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300",
    row: "bg-amber-500/10 dark:bg-amber-400/10",
  },
  orange: {
    tile: "bg-orange-500/15 text-orange-600 dark:bg-orange-400/15 dark:text-orange-300",
    row: "bg-orange-500/10 dark:bg-orange-400/10",
  },
  rose: {
    tile: "bg-rose-500/15 text-rose-600 dark:bg-rose-400/15 dark:text-rose-300",
    row: "bg-rose-500/10 dark:bg-rose-400/10",
  },
  pink: {
    tile: "bg-pink-500/15 text-pink-600 dark:bg-pink-400/15 dark:text-pink-300",
    row: "bg-pink-500/10 dark:bg-pink-400/10",
  },
  fuchsia: {
    tile: "bg-fuchsia-500/15 text-fuchsia-600 dark:bg-fuchsia-400/15 dark:text-fuchsia-300",
    row: "bg-fuchsia-500/10 dark:bg-fuchsia-400/10",
  },
  violet: {
    tile: "bg-violet-500/15 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300",
    row: "bg-violet-500/10 dark:bg-violet-400/10",
  },
  indigo: {
    tile: "bg-indigo-500/15 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300",
    row: "bg-indigo-500/10 dark:bg-indigo-400/10",
  },
  sky: {
    tile: "bg-sky-500/15 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300",
    row: "bg-sky-500/10 dark:bg-sky-400/10",
  },
  cyan: {
    tile: "bg-cyan-500/15 text-cyan-600 dark:bg-cyan-400/15 dark:text-cyan-300",
    row: "bg-cyan-500/10 dark:bg-cyan-400/10",
  },
  teal: {
    tile: "bg-teal-500/15 text-teal-600 dark:bg-teal-400/15 dark:text-teal-300",
    row: "bg-teal-500/10 dark:bg-teal-400/10",
  },
  emerald: {
    tile: "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300",
    row: "bg-emerald-500/10 dark:bg-emerald-400/10",
  },
  lime: {
    tile: "bg-lime-500/20 text-lime-700 dark:bg-lime-400/15 dark:text-lime-300",
    row: "bg-lime-500/10 dark:bg-lime-400/10",
  },
};

export function topicRowTint(topic: MajordomeTopic): string {
  return TONES[topicTone(topic)].row;
}

/** The topic's icon on a tile in its colour, with its conversation's status as a dot on the corner. */
export function TopicIconBadge({
  topic,
  statusDotClass,
  className,
}: {
  readonly topic: MajordomeTopic;
  readonly statusDotClass: string | null;
  readonly className?: string;
}) {
  const { Icon } = ICONS[topicIcon(topic)];
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
        TONES[topicTone(topic)].tile,
        className,
      )}
    >
      <Icon className="size-4" />
      {statusDotClass !== null ? (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-sidebar",
            statusDotClass,
          )}
        />
      ) : null}
    </span>
  );
}

const PICKER_BUTTON_CLASS =
  "flex cursor-pointer items-center justify-center rounded-lg border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:opacity-60 aria-pressed:border-border aria-pressed:bg-accent aria-pressed:text-foreground";

/** A grid of the icons a topic can wear, and "Automatic" to let its name pick one. */
export function TopicIconDialog({
  vault,
  topic,
  onClose,
}: {
  readonly vault: MajordomeVault;
  readonly topic: MajordomeTopic;
  readonly onClose: () => void;
}) {
  const updateTopic = useAtomCommand(majordomeEnvironment.updateTopic, {
    label: "change a topic's icon",
    reportFailure: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const automatic = ICONS[autoTopicIcon(topic.title, topic.folder)];

  const choose = async (icon: MajordomeTopicIcon | null) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await updateTopic({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId, topicId: topic.id, icon },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : String(failure));
      return;
    }
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Icon for {topic.title}</DialogTitle>
          <DialogDescription>
            Automatic picks one from the topic's name and folder.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <button
            type="button"
            aria-pressed={topic.icon === undefined}
            disabled={busy}
            onClick={() => void choose(null)}
            className={cn(PICKER_BUTTON_CLASS, "h-11 w-full justify-start gap-2.5 px-3 text-sm")}
          >
            <automatic.Icon className="size-5" />
            Automatic
          </button>
          <div
            role="group"
            aria-label="Icons"
            className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1"
          >
            {MAJORDOME_TOPIC_ICONS.map((key) => {
              const { Icon, label } = ICONS[key];
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={label}
                  aria-pressed={topic.icon === key}
                  disabled={busy}
                  onClick={() => void choose(key)}
                  className={cn(PICKER_BUTTON_CLASS, "aspect-square")}
                >
                  <Icon className="size-5" />
                </button>
              );
            })}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
