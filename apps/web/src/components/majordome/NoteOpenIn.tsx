import { useAtomValue } from "@effect/atom-react";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";
import { useMessages } from "gt-react";
import {
  ChevronDownIcon,
  CopyIcon,
  FolderClosedIcon,
  GemIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react";
import { Fragment } from "react";

import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { openRemoteEditorUrl, useRemoteOpenResolution } from "../../remoteOpen";
import { filesystemEnvironment } from "../../state/filesystem";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { resolveOpenInOptions } from "../chat/OpenInPicker";
import {
  revealInFileExplorerLabelForKind,
  revealInFileExplorerLabelForOs,
} from "../preview/fileExplorerLabel";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuItemLabel, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import {
  mainNoteOpenTarget,
  noteOpenEditorId,
  type NoteOpenTarget,
  noteOpenTargets,
  obsidianOpenUrl,
} from "./noteOpen.logic";
import type { NotesVault } from "./notes.logic";

const LAST_NOTE_OPEN_KEY = "majordome:notes-open-in";
const LastNoteOpen = Schema.NullOr(Schema.String);

/**
 * Opens the file shown on the Notes page in another app on this computer. Renders nothing for a
 * file kept on another computer: an app here could not open it.
 */
export function NoteOpenIn({
  vault,
  absolutePath,
}: {
  readonly vault: NotesVault;
  readonly absolutePath: string;
}) {
  const where = useRemoteOpenResolution(vault.environmentId);
  if (!where.isResolved || where.state.mode !== "local-exec") return null;
  return <NoteOpenInControl vault={vault} absolutePath={absolutePath} />;
}

function NoteOpenInControl({
  vault,
  absolutePath,
}: {
  readonly vault: NotesVault;
  readonly absolutePath: string;
}) {
  const messages = useMessages();
  const where = useRemoteOpenResolution(vault.environmentId);
  const canOperate = useEnvironmentScope(vault.environmentId, AuthOrchestrationOperateScope);
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(vault.environmentId));
  const obsidianFolder = useAtomValue(
    filesystemEnvironment.getMetadata({
      environmentId: vault.environmentId,
      input: { paths: [`${vault.workspaceRoot.replace(/[\\/]+$/, "")}/.obsidian`] },
    }),
  );
  const [lastUsed, setLastUsed] = useLocalStorage(LAST_NOTE_OPEN_KEY, null, LastNoteOpen);
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });

  const availableEditors = serverConfig?.availableEditors ?? [];
  const targets = noteOpenTargets({
    where,
    canOperate,
    availableEditors,
    canReveal: serverConfig?.shellRevealInFileManager === true,
    hasObsidianFolder:
      AsyncResult.getOrElse(obsidianFolder, () => null)?.entries[0]?.kind === "directory",
  });
  const main = mainNoteOpenTarget(targets, lastUsed);
  if (main === null) return null;

  const editorOptions = resolveOpenInOptions(navigator.platform, availableEditors, messages);
  const revealLabel =
    serverConfig?.shellRevealInFileManagerKind !== undefined
      ? revealInFileExplorerLabelForKind(serverConfig.shellRevealInFileManagerKind, messages)
      : serverConfig
        ? revealInFileExplorerLabelForOs(serverConfig.environment.platform.os, messages)
        : "Show in folder";

  const describe = (target: NoteOpenTarget) => {
    const editor = noteOpenEditorId(target);
    if (editor !== null) {
      const option = editorOptions.find(({ value }) => value === editor);
      const label = option?.label ?? editor;
      return {
        label,
        action: `Open in ${label}`,
        Icon: option?.Icon ?? SquareArrowOutUpRightIcon,
        problem: `This file couldn't be opened in ${label}.`,
      };
    }
    if (target === "obsidian") {
      return {
        label: "Obsidian",
        action: "Open in Obsidian",
        Icon: GemIcon,
        problem: "This file couldn't be opened in Obsidian.",
      };
    }
    if (target === "default-app") {
      return {
        label: "Default app",
        action: "Open",
        Icon: SquareArrowOutUpRightIcon,
        problem: "This file couldn't be opened.",
      };
    }
    if (target === "reveal") {
      return {
        label: revealLabel,
        action: revealLabel,
        Icon: editorOptions.find(({ value }) => value === "file-manager")?.Icon ?? FolderClosedIcon,
        problem: "This file couldn't be shown in its folder.",
      };
    }
    return {
      label: "Copy path",
      action: "Copy path",
      Icon: CopyIcon,
      problem: "The path couldn't be copied.",
    };
  };

  const run = async (target: NoteOpenTarget): Promise<boolean> => {
    if (target === "copy-path") {
      return writeTextToClipboard(absolutePath).then(
        (copied) => {
          if (copied) toastManager.add({ type: "success", title: "Path copied" });
          return copied;
        },
        () => false,
      );
    }
    if (target === "obsidian") return openRemoteEditorUrl(obsidianOpenUrl(absolutePath));
    const editor = noteOpenEditorId(target);
    const result = await openInEditor({
      environmentId: vault.environmentId,
      input:
        editor !== null
          ? { cwd: absolutePath, editor, position: {}, projectRoot: vault.workspaceRoot }
          : {
              cwd: absolutePath,
              editor: "file-manager",
              ...(target === "reveal" ? { reveal: true } : {}),
            },
    });
    // Leaving the page mid-call is not a failure to report.
    return result._tag !== "Failure" || isAtomCommandInterrupted(result);
  };

  const open = (target: NoteOpenTarget) => {
    if (target !== "copy-path") setLastUsed(target);
    void run(target).then((opened) => {
      if (!opened) toastManager.add({ type: "error", title: describe(target).problem });
    });
  };

  const mainEntry = describe(main);
  return (
    <Group aria-label="Open in another app">
      <Button size="xs" variant="outline" onClick={() => open(main)}>
        <mainEntry.Icon aria-hidden="true" />
        {mainEntry.action}
      </Button>
      <GroupSeparator />
      <Menu>
        <MenuTrigger render={<Button size="icon-xs" variant="outline" aria-label="Open in…" />}>
          <ChevronDownIcon aria-hidden="true" />
        </MenuTrigger>
        <MenuPopup align="end">
          {targets.map((target) => {
            const entry = describe(target);
            return (
              <Fragment key={target}>
                {target === "copy-path" && targets.length > 1 ? <MenuSeparator /> : null}
                <MenuItem onClick={() => open(target)}>
                  <entry.Icon aria-hidden="true" />
                  <MenuItemLabel>{entry.label}</MenuItemLabel>
                </MenuItem>
              </Fragment>
            );
          })}
        </MenuPopup>
      </Menu>
    </Group>
  );
}
