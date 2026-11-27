import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { SpeechPort } from "./readAloudRuntime";

// A fake engine that records what it was asked to say, over an in-memory voice folder.
const fake = vi.hoisted(() => ({
  said: [] as Array<{ text: string; voice: number; lang: string }>,
  stops: 0,
  disk: new Map<string, string>(),
  served: {} as Record<string, string>,
  opened: 0,
  closed: 0,
  drained: () => {},
}));

const CONTENT: Record<string, string> = { "model.onnx": "0123456789", "voice.bin": "abcdef" };

vi.mock("./platform", async () => {
  const { createReadAloudRuntime } = await import("./readAloudRuntime");
  const baseUrl = "https://voices.test/v1";
  const readAloud = createReadAloudRuntime({
    speech: {
      load: async () => ({ voices: 2 }),
      unload: async () => {},
      speak: (text, options) => fake.said.push({ text, voice: options.voice, lang: options.lang }),
      stop: () => void (fake.stops += 1),
      measure: async () => {
        throw new Error("not measured here");
      },
      addListener: ((event: string, listener: () => void) => {
        if (event === "drained") fake.drained = listener;
        return { remove: () => {} };
      }) as SpeechPort["addListener"],
    },
    catalog: {
      id: "test-1",
      name: "Test",
      baseUrl,
      license: "openrail-m",
      copyright: "",
      languages: ["en", "fr"],
      // The fake digest is the content, so a wrong byte is a wrong checksum.
      files: [
        { name: "model.onnx", size: 10, sha256: "0123456789" },
        { name: "voice.bin", size: 6, sha256: "abcdef" },
      ],
    },
    files: {
      size: async (name) => fake.disk.get(name)?.length ?? null,
      sha256: async (name) => fake.disk.get(name) ?? "",
      fetchInto: async ({ url, name, offset, onBytes }) => {
        const body = fake.served[url.slice(baseUrl.length + 1)];
        if (body === undefined) return { status: 404 };
        fake.disk.set(name, (offset > 0 ? (fake.disk.get(name) ?? "") : "") + body.slice(offset));
        onBytes(body.length - offset);
        return { status: offset > 0 ? 206 : 200 };
      },
      rename: async (from, to) => {
        fake.disk.set(to, fake.disk.get(from)!);
        fake.disk.delete(from);
      },
      remove: async (name) => void fake.disk.delete(name),
    },
    directoryUri: "file:///voices/test-1/",
    takeAudio: async () => () => {},
    settle: async () => {},
    openDownload: () => void (fake.opened += 1),
    reportError: () => {},
    placeholders: () => ({
      codeLine: "There is code on screen.",
      tableLine: "There is a table on screen.",
      linkWord: "a link",
    }),
    appLanguage: () => "en",
    readVoice: () => 1,
    writeVoice: () => {},
  });
  return { readAloud, setReadAloudAppLanguage: () => {} };
});

type PressableProps = {
  readonly children?: ReactNode;
  readonly accessibilityLabel?: string;
  readonly onPress?: () => void;
};
vi.mock("react-native", () => ({
  Pressable: (props: PressableProps) => (
    <button aria-label={props.accessibilityLabel} onClick={props.onPress} />
  ),
  View: (props: { children?: ReactNode }) => <div>{props.children}</div>,
}));
vi.mock("gt-react-native", () => ({
  useGT:
    () =>
    (text: string, values: Record<string, unknown> = {}) =>
      text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key])),
  useLocale: () => "en",
}));
vi.mock("@react-navigation/native", () => {
  const navigation = { goBack: () => void (fake.closed += 1) };
  return { useNavigation: () => navigation };
});
vi.mock("expo-network", () => ({
  NetworkStateType: { CELLULAR: "CELLULAR" },
  useNetworkState: () => ({ type: "CELLULAR" }),
}));
vi.mock("../../components/ui/FitSheet", () => ({
  FitSheet: (props: { header: ReactNode; children: ReactNode }) => (
    <div>
      {props.header}
      {props.children}
    </div>
  ),
}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../components/ui/AppText", () => ({
  AppText: (props: { children?: ReactNode }) => <p>{props.children}</p>,
}));
vi.mock("../../components/ui/Button", () => ({
  Button: (props: { label: string; onPress: () => void }) => (
    <button aria-label={props.label} onClick={props.onPress} />
  ),
}));
vi.mock("../../components/ui/Progress", () => ({ Progress: () => <progress /> }));
vi.mock("../../components/ui/SheetHeader", () => ({
  SheetHeader: (props: { title: string }) => <h1>{props.title}</h1>,
}));

import { readAloud } from "./platform";
import { ReadAloudButton, readAloudReplyKey, useStopReadAloudOnLeave } from "./ReadAloudButton";
import { VoiceDownloadSheet } from "./VoiceDownloadSheet";

const REPLY = [
  "Here is the fix. Run it once:",
  "",
  "```sh",
  "rm -rf node_modules",
  "```",
  "",
  "Then **restart** the [app](https://example.com/app).",
].join("\n");

function Chat(props: { readonly chat: string }) {
  useStopReadAloudOnLeave(props.chat);
  return (
    <ReadAloudButton
      replyKey={readAloudReplyKey(props.chat, "reply-1")}
      markdown={REPLY}
      tintColor="black"
      buttonSize={30}
      iconSize={13}
    />
  );
}

let container: HTMLDivElement;
let root: Root;
const button = (label: string) => container.querySelector(`button[aria-label="${label}"]`);
const press = async (label: string) => {
  const target = button(label);
  if (!(target instanceof HTMLButtonElement)) throw new Error(`No "${label}" button`);
  await act(async () => {
    target.click();
    // Every fake resolves at once, so the work the press started ends within these turns.
    for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
  });
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fake.said.length = 0;
  fake.stops = 0;
  fake.opened = 0;
  fake.closed = 0;
  fake.disk.clear();
  fake.served = { ...CONTENT };
  await readAloud!.remove();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => act(() => root.unmount()));

describe("Read aloud on a reply", () => {
  it("says the prose without the code block, and the action becomes Stop", async () => {
    for (const [name, content] of Object.entries(CONTENT)) fake.disk.set(name, content);
    await act(async () => root.render(<Chat chat="a" />));

    await press("Read aloud");

    expect(fake.said.map((sentence) => sentence.text)).toEqual([
      "Here is the fix.",
      "Run it once:",
      "There is code on screen.",
      "Then restart the app.",
    ]);
    expect(fake.said.every((sentence) => sentence.voice === 1 && sentence.lang === "en")).toBe(
      true,
    );
    expect(button("Stop")).not.toBeNull();
    expect(button("Read aloud")).toBeNull();

    await press("Stop");
    expect(fake.stops).toBe(1);
    expect(button("Read aloud")).not.toBeNull();
  });

  it("returns to Read aloud when the voice has said everything", async () => {
    for (const [name, content] of Object.entries(CONTENT)) fake.disk.set(name, content);
    await act(async () => root.render(<Chat chat="a" />));
    await press("Read aloud");

    await act(async () => fake.drained());

    expect(button("Read aloud")).not.toBeNull();
    expect(fake.stops).toBe(0);
  });

  it("stops when the chat is left", async () => {
    for (const [name, content] of Object.entries(CONTENT)) fake.disk.set(name, content);
    await act(async () => root.render(<Chat chat="a" />));
    await press("Read aloud");

    await act(async () => root.render(<Chat chat="b" />));

    expect(fake.stops).toBe(1);
    expect(readAloud!.controller.getState()).toEqual({ status: "idle" });
  });

  it("offers the download first, then reads the reply that asked", async () => {
    await act(async () => root.render(<Chat chat="a" />));
    await press("Read aloud");
    expect(fake.opened).toBe(1);
    expect(fake.said).toEqual([]);

    await act(async () => root.render(<VoiceDownloadSheet />));
    expect(container.querySelector("h1")?.textContent).toBe("Voice");
    expect(container.textContent).toContain("145 MB, downloaded once.");
    await press("Download on mobile data");

    expect(readAloud!.store.getState()).toEqual({ status: "ready" });
    expect(fake.closed).toBe(1);
    expect(fake.said[0]?.text).toBe("Here is the fix.");
  });

  it("keeps the download button when a checksum fails", async () => {
    fake.served["voice.bin"] = "abcdeX";
    await act(async () => root.render(<Chat chat="a" />));
    await press("Read aloud");
    await act(async () => root.render(<VoiceDownloadSheet />));

    await press("Download on mobile data");

    expect(readAloud!.store.getState()).toEqual({ status: "failed", reason: "verification" });
    expect(button("Download on mobile data")).not.toBeNull();
    expect(container.textContent).toContain("The download was damaged. Try again.");
    expect(fake.said).toEqual([]);
    expect(fake.closed).toBe(0);
  });
});
