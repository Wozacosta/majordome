import { Link } from "@tanstack/react-router";
import { useMessages } from "gt-react";
import {
  BotIcon,
  CloudUploadIcon,
  ConciergeBellIcon,
  FolderOpenIcon,
  GraduationCapIcon,
  PlugIcon,
  ServerIcon,
  UserRoundIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { SettingsPageContainer } from "../settings/settingsLayout";
import {
  SETTINGS_NAV_LABELS,
  type SettingsGuideTopic,
  type SettingsPath,
  settingsNavGroups,
} from "../settings/settingsSearch";
import { useHasSecretProvidersEnvironment } from "../settings/useAvailableSettingsSearchItems";
import { AppWindowSketch } from "./AppWindowSketch";
import { FlowDiagram, type FlowLine, type FlowNode } from "./FlowDiagram";
import { Entry, EntryList, PageHeader, Section } from "./paper";
import { ServersMap } from "./ServersMap";
import { useServers } from "./YourServers";

interface Guide {
  readonly intro: string;
  /** The drawing's own heading. */
  readonly drawing: string;
  /** What each page of the part is for, in a line. A page without one is listed by name alone. */
  readonly pages: Partial<Record<SettingsPath, string>>;
}

const GUIDES: Record<SettingsGuideTopic, Guide> = {
  app: {
    intro:
      "How Majordome looks and behaves on this device: its language and colours, how you write and speak to it, and the pages it opens beside a chat. These choices stay on this device.",
    drawing: "Where each setting acts",
    pages: {
      "/settings/general":
        "Language, what opens when the app starts, and how it runs in the background.",
      "/settings/appearance": "Light or dark, the colours and the size of the text.",
      "/settings/chat": "How the message box behaves, and what Enter does.",
      "/settings/voice": "Speaking to Majordome instead of typing, and having answers read out.",
      "/settings/browser": "The web pages the assistant opens beside a chat.",
      "/settings/keybindings": "The keys that open, search and move around the app.",
    },
  },
  notes: {
    intro:
      "Your notes are ordinary files in a folder you choose. The assistant reads them and writes to them, and nothing else holds your notes. A backup keeps a second copy somewhere safe.",
    drawing: "Where your notes are",
    pages: {
      "/settings/projects": "Which folders Majordome keeps your notes in, and what is in each.",
      "/settings/backup": "A second, encrypted copy of your notes, and how to get them back.",
    },
  },
  ai: {
    intro:
      "The assistant is three things put together: an AI account that does the thinking, connections to the services you already use, and skills that tell it how you like things done.",
    drawing: "What the assistant is made of",
    pages: {
      "/settings/providers": "The AI that answers, signed in with your own plan.",
      "/settings/connectors": "Your mail, calendar and other services the assistant may use.",
      "/settings/skills": "Step-by-step ways of doing things that the assistant follows.",
    },
  },
  devices: {
    intro:
      "Majordome runs on this computer, and can also run on a server that never sleeps. Your phone opens whichever one is the main one. An account, if you want one, lets a new device find them without a code.",
    drawing: "What opens what",
    pages: {
      "/settings/phone": "Open Majordome from your phone, and choose what it tells you about.",
      "/settings/always-on":
        "The computers that stay on for you, what is on each, and how to get one.",
      "/settings/account": "Sign in so a new phone or computer finds your servers by itself.",
    },
  },
};

const node = (id: string, icon: FlowNode["icon"], title: string, detail: string): FlowNode => ({
  id,
  icon,
  title,
  detail,
});

const DRAWINGS: Record<
  Exclude<SettingsGuideTopic, "app" | "devices">,
  {
    readonly columns: ReadonlyArray<ReadonlyArray<FlowNode>>;
    readonly lines: ReadonlyArray<FlowLine>;
    readonly summary: string;
  }
> = {
  notes: {
    columns: [
      [node("you", UserRoundIcon, "You and the assistant", "Read and write notes")],
      [node("folder", FolderOpenIcon, "Notes folders", "Plain files on this computer")],
      [
        node("backup", CloudUploadIcon, "Back up my brain", "An encrypted second copy"),
        node("servers", ServerIcon, "Your servers", "A copy that follows this one"),
      ],
    ],
    lines: [
      { from: "you", to: "folder" },
      { from: "folder", to: "backup" },
      { from: "folder", to: "servers" },
    ],
    summary:
      "You and the assistant read and write notes in your notes folders, plain files on this computer. From there a backup keeps an encrypted second copy, and your servers keep a copy that follows this one.",
  },
  ai: {
    columns: [
      [node("you", UserRoundIcon, "You", "Ask, or a routine runs")],
      [node("assistant", ConciergeBellIcon, "The assistant", "Reads your notes, then acts")],
      [
        node("account", BotIcon, "AI accounts", "Does the thinking"),
        node("connections", PlugIcon, "Connections", "Mail, calendar, other services"),
        node("skills", GraduationCapIcon, "Skills", "How you like things done"),
      ],
    ],
    lines: [
      { from: "you", to: "assistant" },
      { from: "assistant", to: "account" },
      { from: "assistant", to: "connections" },
      { from: "assistant", to: "skills" },
    ],
    summary:
      "You ask the assistant, or a routine runs. The assistant reads your notes and uses three things: an AI account that does the thinking, connections to your mail, calendar and other services, and skills that say how you like things done.",
  },
};

/** The live drawing of this device, the phone and the servers, as on Your servers. */
function DevicesDrawing() {
  return <ServersMap servers={useServers()} />;
}

/**
 * The page behind one part of Settings: what the part is, a drawing of how its pieces fit, and
 * its pages with a line each. Written for someone who has never opened Settings.
 */
export function SettingsGuidePage({ topic }: { readonly topic: SettingsGuideTopic }) {
  const m = useMessages();
  const group = settingsNavGroups(useHasSecretProvidersEnvironment()).find(
    (candidate) => candidate.guide === topic,
  );
  const guide = GUIDES[topic];
  if (group === undefined) return null;
  const drawing: ReactNode =
    topic === "devices" ? (
      <DevicesDrawing />
    ) : topic === "app" ? (
      <AppWindowSketch />
    ) : (
      <FlowDiagram {...DRAWINGS[topic]} />
    );
  return (
    <SettingsPageContainer>
      <PageHeader title={m(group.heading)} intro={guide.intro} />
      <Section label={guide.drawing}>{drawing}</Section>
      <Section label="In this part">
        <EntryList>
          {group.paths.map((to) => (
            <Entry
              key={to}
              title={
                <Link to={to} className="underline-offset-2 hover:underline">
                  {m(SETTINGS_NAV_LABELS[to])}
                </Link>
              }
              meta={guide.pages[to]}
              actions={
                <Link
                  to={to}
                  aria-label={`Open ${m(SETTINGS_NAV_LABELS[to])}`}
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  Open
                </Link>
              }
            />
          ))}
        </EntryList>
      </Section>
    </SettingsPageContainer>
  );
}
