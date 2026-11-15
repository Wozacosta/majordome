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
import { autoTopicIcon, topicIcon } from "./topicIcons.logic";
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

/** The topic's icon, with its conversation's status as a dot on the corner. */
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
    <span aria-hidden className={cn("relative inline-flex shrink-0", className)}>
      <Icon className="size-4 text-sidebar-muted-foreground" />
      {statusDotClass !== null ? (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-sidebar",
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
