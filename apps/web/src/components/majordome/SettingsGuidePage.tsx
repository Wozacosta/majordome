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

import { ClaudeAI, OpenAI } from "../Icons";
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
  /** What each page of the part is for, in a line. A page without one is listed by name alone. */
  readonly pages: Partial<Record<SettingsPath, string>>;
}

const GUIDES: Record<SettingsGuideTopic, Guide> = {
  app: {
    intro: "How Majordome looks and behaves on this device.",
    pages: {
      "/settings/general": "Language, start-up, running in the background.",
      "/settings/appearance": "Light or dark, colours, text size.",
      "/settings/chat": "The message box, and what Enter does.",
      "/settings/voice": "Speaking instead of typing; answers read out.",
      "/settings/browser": "Web pages opened beside a chat.",
      "/settings/keybindings": "The keys that drive the app.",
    },
  },
  notes: {
    intro: "Your notes are ordinary files in a folder you choose.",
    pages: {
      "/settings/projects": "The folders your notes are in.",
      "/settings/backup": "An encrypted second copy, and getting it back.",
    },
  },
  ai: {
    intro: "What the assistant thinks with, and what it may use.",
    pages: {
      "/settings/providers": "The AI that answers, on your own plan.",
      "/settings/connectors": "Mail, calendar and other services it may use.",
      "/settings/skills": "How-tos the assistant follows.",
    },
  },
  devices: {
    intro: "Where Majordome runs, and what opens it.",
    pages: {
      "/settings/phone": "Majordome on your phone, and what it tells you.",
      "/settings/always-on": "Computers that stay on for you.",
      "/settings/account": "Lets a new device find your servers.",
    },
  },
};

/** A box of a drawing, by name alone. One that stands for a settings page opens it. */
const node = (id: string, icon: FlowNode["icon"], title: string, to?: SettingsPath): FlowNode => ({
  id,
  icon,
  title,
  ...(to ? { to } : {}),
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
      [node("you", UserRoundIcon, "You and the assistant")],
      [node("folder", FolderOpenIcon, "Notes folders", "/settings/projects")],
      [
        node("backup", CloudUploadIcon, "Back up my brain", "/settings/backup"),
        node("servers", ServerIcon, "Your servers", "/settings/always-on"),
      ],
    ],
    lines: [
      { from: "you", to: "folder" },
      { from: "folder", to: "backup" },
      { from: "folder", to: "servers" },
    ],
    summary:
      "You and the assistant read and write notes in your notes folders. From there a backup keeps an encrypted second copy, and your servers keep a copy that follows this one.",
  },
  ai: {
    columns: [
      [node("you", UserRoundIcon, "You")],
      [node("assistant", ConciergeBellIcon, "The assistant")],
      [
        {
          ...node("account", BotIcon, "AI accounts", "/settings/providers"),
          marks: [ClaudeAI, OpenAI],
        },
        {
          ...node("connections", PlugIcon, "Connections", "/settings/connectors"),
          detail: "Gmail, Calendar, MCP",
        },
        {
          ...node("skills", GraduationCapIcon, "Skills", "/settings/skills"),
          detail: "e.g. your weekly review",
        },
      ],
    ],
    lines: [
      { from: "you", to: "assistant" },
      { from: "assistant", to: "account" },
      { from: "assistant", to: "connections" },
      { from: "assistant", to: "skills" },
    ],
    summary:
      "You ask the assistant. It uses three things: an AI account that does the thinking, connections to your mail, calendar and other services, and skills that say how you like things done.",
  },
};

/** The live drawing of this device, the phone and the servers, as on Your servers. */
function DevicesDrawing() {
  return <ServersMap servers={useServers()} serversOpenTheirPage />;
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
      <Section>{drawing}</Section>
      <Section>
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
            />
          ))}
        </EntryList>
      </Section>
    </SettingsPageContainer>
  );
}
