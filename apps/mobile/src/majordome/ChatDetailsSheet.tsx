import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { refreshMajordomeKeyFacts } from "@t3tools/client-runtime/state/majordome";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  MAJORDOME_TOPIC_FILE_MAX_BYTES,
  MAJORDOME_TOPIC_FILE_TOO_LARGE,
  type MajordomeKeyFactKind,
  type MajordomeTopicsResult,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import {
  CHAT_KNOWLEDGE_OTHERS_LINE,
  CHAT_KNOWLEDGE_OTHERS_TITLE,
  CHAT_KNOWLEDGE_TITLE,
  CHAT_KNOWLEDGE_TOPICS_TITLE,
  type ChatKnowledgeRow,
  chatKnowledgeView,
} from "@t3tools/shared/majordomeChatKnowledge";
import { keyFactGroups, type KeyFactRow, localDay } from "@t3tools/shared/majordomeKeyFacts";
import {
  isNoteFileName,
  moreFilesLine,
  topicFileDate,
  type TopicFileRow,
  topicFileRows,
} from "@t3tools/shared/majordomeTopicFiles";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../components/ui/AppActivityIndicator";
import { type AppSymbolName, SymbolView } from "../components/ui/AppSymbol";
import { AppText as Text } from "../components/ui/AppText";
import * as Dialog from "../components/ui/Dialog";
import { ScreenContent } from "../components/ui/ScreenContent";
import { SheetHeader } from "../components/ui/SheetHeader";
import { FilePreviewModal, type FilePreviewSource } from "../components/ui/FilePreviewModal";
import {
  type AttachmentPreviewFile,
  downloadAttachmentForPreview,
  nativeViewerErrorMessage,
} from "../lib/attachmentDownload";
import { beginForegroundHandoff } from "../lib/foreground-handoff";
import { appAtomRegistry } from "../state/atom-registry";
import { attachmentEnvironment } from "../state/attachments";
import { usePreparedConnection } from "../state/session";
import { environmentThreadShells } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { fileMediaType, type PickedFile, pickFiles, uploadPickedFile } from "./chatDetails.logic";
import { majordomeEnvironment } from "./state";

const NOT_CONNECTED = "Majordome isn't connected to this computer right now.";

const failureMessage = (result: AtomCommandResult<unknown, unknown>) => {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : String(error);
};

const NO_TOPICS = Atom.make(AsyncResult.initial<MajordomeTopicsResult, never>(false)).pipe(
  Atom.withLabel("majordome:chat-details:no-topics"),
);

type ChatTarget = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

/**
 * What sits beside a chat on the computer: its key facts and the conversation in short, and for
 * a topic's own chat the files kept with the topic.
 */
export function ChatDetailsSheet({ route }: StaticScreenProps<ChatTarget>) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { environmentId, threadId } = route.params;
  const thread = useAtomValue(
    environmentThreadShells.threadShellAtom(scopeThreadRef(environmentId, threadId)),
  );
  const projectId = thread?.projectId ?? null;
  // Asked of the chat's own computer: a phone can talk to several, each with its own topics.
  const listed = AsyncResult.getOrElse(
    useAtomValue(
      projectId === null
        ? NO_TOPICS
        : majordomeEnvironment.topics({ environmentId, input: { projectId } }),
    ),
    () => null,
  );
  const topic = listed?.topics.find(
    (candidate) => candidate.threadId === threadId && candidate.folderExists,
  );
  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <SheetHeader
        title={topic === undefined ? "Key facts" : "Key facts and files"}
        onClose={() => navigation.goBack()}
      />
      <ScreenContent>
        <ScrollView
          nestedScrollEnabled
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="gap-6 px-5 pt-2"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
        >
          <KeyFacts environmentId={environmentId} threadId={threadId} />
          {projectId !== null && topic ? (
            <TopicFiles environmentId={environmentId} projectId={projectId} topicId={topic.id} />
          ) : null}
          <ChatKnowledge environmentId={environmentId} threadId={threadId} />
        </ScrollView>
      </ScreenContent>
    </View>
  );
}

function Section(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <View>
      <Text
        accessibilityRole="header"
        textRole="footnote"
        className="pb-1 font-t3-medium text-foreground-muted"
      >
        {props.title}
      </Text>
      {props.children}
    </View>
  );
}

function Row(props: {
  readonly icon: AppSymbolName;
  readonly label: string;
  readonly detail: string | null;
  readonly detailLines?: number;
  readonly accessibilityLabel: string;
  readonly busy?: boolean;
  readonly onPress?: (() => void) | undefined;
  readonly onLongPress?: (() => void) | undefined;
}) {
  return (
    <Pressable
      accessibilityRole={props.onPress === undefined && !props.onLongPress ? "text" : "button"}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ disabled: props.onPress === undefined, busy: Boolean(props.busy) }}
      disabled={props.onPress === undefined || props.busy}
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      className="flex-row items-center gap-3 border-b border-border py-3 active:opacity-70"
    >
      <SymbolView
        name={props.icon}
        size={16}
        tintColorClassName="accent-foreground-muted"
        type="monochrome"
      />
      <View className="min-w-0 flex-1">
        <Text className="text-sm text-foreground" numberOfLines={2}>
          {props.label}
        </Text>
        {props.detail === null ? null : (
          <Text className="text-xs text-foreground-muted" numberOfLines={props.detailLines ?? 1}>
            {props.detail}
          </Text>
        )}
      </View>
      {props.busy ? <AppActivityIndicator colorClassName="accent-icon" /> : null}
    </Pressable>
  );
}

const Muted = (props: { readonly children: string }) => (
  <Text className="py-1 text-sm text-foreground-muted">{props.children}</Text>
);

const FACT_ICONS: Record<MajordomeKeyFactKind, AppSymbolName> = {
  link: "link",
  place: "mappin",
  date: "calendar",
  person: "person",
};

function KeyFacts({ environmentId, threadId }: ChatTarget) {
  const result = useAtomValue(
    majordomeEnvironment.keyFacts({ environmentId, input: { threadId } }),
  );
  const thread = useAtomValue(
    environmentThreadShells.threadShellAtom(scopeThreadRef(environmentId, threadId)),
  );
  const replyStamp = thread?.latestRun?.completedAt ?? null;
  const seenReplyStamp = useRef(replyStamp);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the facts are read on the server, so a reply that finishes while this is open asks it for them again
  useEffect(() => {
    if (seenReplyStamp.current === replyStamp) return;
    seenReplyStamp.current = replyStamp;
    refreshMajordomeKeyFacts(environmentId, appAtomRegistry);
  }, [replyStamp, environmentId, seenReplyStamp]);
  const [today] = useState(() => localDay(new Date()));
  const [copied, setCopied] = useState<string | null>(null);

  const data = AsyncResult.getOrElse(result, () => null);
  const groups = keyFactGroups(data?.facts ?? [], { today });
  const summary = data?.summary ?? [];
  const press = (fact: KeyFactRow) => {
    if (fact.href !== null) {
      void Linking.openURL(fact.href).catch(() =>
        Dialog.alert("Could not open the link", fact.href ?? undefined),
      );
      return;
    }
    void Clipboard.setStringAsync(fact.value).then(
      () => {
        void Haptics.selectionAsync();
        setCopied(fact.key);
      },
      () => undefined,
    );
  };
  return (
    <>
      {summary.length === 0 ? null : (
        <Section title="In short">
          <View className="gap-1.5 pt-1">
            {summary.map((line) => (
              <View key={line} className="flex-row gap-2">
                <Text className="text-sm text-foreground-muted">•</Text>
                <Text className="min-w-0 flex-1 text-sm text-foreground">{line}</Text>
              </View>
            ))}
          </View>
        </Section>
      )}
      {groups.length === 0 ? (
        <Section title="Key facts">
          <Muted>
            {data === null && result.waiting
              ? "Reading this chat…"
              : data === null && result._tag === "Failure"
                ? "The key facts couldn't be read."
                : "Links, places, dates and names you mention are noted here after each reply."}
          </Muted>
        </Section>
      ) : (
        groups.map((group) => (
          <Section key={group.title} title={group.title}>
            {group.rows.map((fact) => (
              <Row
                key={fact.key}
                icon={FACT_ICONS[fact.kind]}
                label={fact.label}
                detail={copied === fact.key ? "Copied" : fact.detail}
                accessibilityLabel={
                  fact.href === null ? `Copy ${fact.value}` : `Open ${fact.label}`
                }
                onPress={() => press(fact)}
              />
            ))}
          </Section>
        ))
      )}
    </>
  );
}

const KNOWLEDGE_ICONS: Record<ChatKnowledgeRow["kind"], AppSymbolName> = {
  memory: "brain",
  daily: "calendar",
  topic: "folder",
  "other-topic": "bubble.left",
};

/** What the chat starts with and the topics it only knows the standing of; nothing opens here. */
function ChatKnowledge({ environmentId, threadId }: ChatTarget) {
  const result = useAtomValue(
    majordomeEnvironment.chatKnowledge({ environmentId, input: { threadId } }),
  );
  // A server from before this was added answers with a failure, and shows no section.
  const view = chatKnowledgeView(AsyncResult.getOrElse(result, () => null));
  const [othersOpen, setOthersOpen] = useState(false);
  const [restOpen, setRestOpen] = useState(false);
  if (view === null) return null;
  const row = (item: ChatKnowledgeRow) => (
    <Row
      key={item.key}
      icon={KNOWLEDGE_ICONS[item.kind]}
      label={item.label}
      detail={item.detail}
      detailLines={2}
      accessibilityLabel={item.detail === null ? item.label : `${item.label}. ${item.detail}`}
    />
  );
  const othersTitle =
    view.starts[0]?.kind === "topic" ? CHAT_KNOWLEDGE_OTHERS_TITLE : CHAT_KNOWLEDGE_TOPICS_TITLE;
  return (
    <>
      <Section title={CHAT_KNOWLEDGE_TITLE}>{view.starts.map(row)}</Section>
      {view.others.length === 0 ? null : (
        <Section title={othersTitle}>
          <Row
            icon="bubble.left"
            label={`${view.others.length + view.rest.length} topics`}
            detail={othersOpen ? "Tap to hide" : "Tap to show where each one stands"}
            accessibilityLabel={`${othersTitle}, ${othersOpen ? "shown" : "hidden"}`}
            onPress={() => setOthersOpen((open) => !open)}
          />
          {othersOpen ? (
            <>
              <Muted>{CHAT_KNOWLEDGE_OTHERS_LINE}</Muted>
              {view.others.map(row)}
              {restOpen ? view.rest.map(row) : null}
              {view.rest.length === 0 ? null : (
                <Row
                  icon={restOpen ? "chevron.up" : "chevron.down"}
                  label={restOpen ? "Show fewer" : `and ${view.rest.length} more`}
                  detail={null}
                  accessibilityLabel={
                    restOpen ? "Show fewer topics" : `Show ${view.rest.length} more topics`
                  }
                  onPress={() => setRestOpen((open) => !open)}
                />
              )}
            </>
          ) : null}
        </Section>
      )}
    </>
  );
}

function TopicFiles({
  environmentId,
  projectId,
  topicId,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly topicId: string;
}) {
  const where = { projectId, topicId };
  const result = useAtomValue(majordomeEnvironment.topicFiles({ environmentId, input: where }));
  const privateResult = useAtomValue(
    majordomeEnvironment.privateDocuments({ environmentId, input: {} }),
  );
  const canChange = useAtomValue(majordomeEnvironment.addTopicFile.permissionAtom(environmentId));
  const mayUsePrivate = useAtomValue(
    majordomeEnvironment.addPrivateDocument.permissionAtom(environmentId),
  );
  const connection = usePreparedConnection(environmentId);
  const httpBaseUrl = Option.isSome(connection) ? connection.value.httpBaseUrl : null;
  const quiet = { reportFailure: false, reportDefect: false };
  const createUploadUrl = useAtomCommand(attachmentEnvironment.createUploadUrl, quiet);
  const addTopicFile = useAtomCommand(majordomeEnvironment.addTopicFile, quiet);
  const removeTopicFile = useAtomCommand(majordomeEnvironment.removeTopicFile, quiet);
  const viewTopicFile = useAtomCommand(majordomeEnvironment.viewTopicFile, quiet);
  const viewPrivateDocument = useAtomCommand(majordomeEnvironment.viewPrivateDocument, quiet);
  const [adding, setAdding] = useState(false);
  /** The row being opened or removed. */
  const [working, setWorking] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  /** The file being looked at, with the phone's copy of it. */
  const [shown, setShown] = useState<{
    readonly file: AttachmentPreviewFile;
    readonly source: FilePreviewSource;
  } | null>(null);
  const closeShown = () => {
    shown?.file.dispose();
    setShown(null);
  };
  const leaving = useRef<AbortController | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- stops a file still downloading when the sheet closes
  useEffect(() => {
    const controller = new AbortController();
    leaving.current = controller;
    return () => controller.abort();
  }, [leaving]);

  const data = AsyncResult.getOrElse(result, () => null);
  if (data === null) {
    // A server from before topics had files shows no section; a failed read says so once.
    const unknown =
      result._tag === "Failure" &&
      String(squashAtomCommandFailure(result)).startsWith("Unknown request tag");
    return result._tag !== "Failure" || unknown ? null : (
      <Section title="Files">
        <Muted>This topic's files couldn't be read.</Muted>
      </Section>
    );
  }
  const rows = topicFileRows(
    data.files,
    AsyncResult.getOrElse(privateResult, () => null)?.documents ?? [],
    where,
  );
  const more = moreFilesLine(data.total, data.files.length);

  const open = async (row: TopicFileRow) => {
    setWorking(row.key);
    const link =
      row.kind === "private"
        ? await viewPrivateDocument({ environmentId, input: { id: row.document.id } })
        : await viewTopicFile({ environmentId, input: { projectId, path: row.path } });
    const url =
      link._tag === "Success" && httpBaseUrl !== null
        ? resolveAssetUrl(httpBaseUrl, link.value.relativeUrl)
        : null;
    const signal = leaving.current?.signal ?? new AbortController().signal;
    const mimeType = row.kind === "private" ? row.document.mediaType : fileMediaType(row.name);
    // A copy on the phone: the address lasts a minute, and the viewer keeps what it is given.
    const file =
      url === null
        ? null
        : await downloadAttachmentForPreview({
            url,
            attachment: { name: row.name, mimeType },
            signal,
          }).catch(() => null);
    const problem =
      url === null
        ? (failureMessage(link) ?? NOT_CONNECTED)
        : file === null
          ? "The file could not be downloaded. Check the connection and try again."
          : null;
    if (file !== null) {
      setShown({
        file,
        source: {
          kind: mimeType.startsWith("image/")
            ? "image"
            : mimeType === "application/pdf"
              ? "pdf"
              : "document",
          name: row.name,
          mimeType,
          uri: file.uri,
        },
      });
    }
    setWorking(null);
    if (problem !== null && !signal.aborted) Dialog.alert(`Could not open ${row.name}`, problem);
  };

  const remove = (row: TopicFileRow & { readonly kind: "file" }) =>
    Dialog.confirm({
      title: `Remove “${row.name}”?`,
      message:
        "It is deleted from this topic's folder. Your notes' history keeps a copy, so your assistant can bring it back if you ask.",
      confirmText: "Remove",
      destructive: true,
      onConfirm: () => {
        setWorking(row.key);
        void removeTopicFile({ environmentId, input: { projectId, path: row.path } }).then(
          (removed) => {
            setWorking(null);
            const problem = failureMessage(removed);
            if (problem !== null) Dialog.alert("Could not remove it", problem);
          },
        );
      },
    });

  /** The upload's id on the server, or why it did not arrive. */
  const send = async (
    file: PickedFile,
  ): Promise<{ readonly id: string } | { readonly problem: string }> => {
    if (file.sizeBytes === 0) return { problem: "That file is empty." };
    if (file.sizeBytes > MAJORDOME_TOPIC_FILE_MAX_BYTES) {
      return { problem: MAJORDOME_TOPIC_FILE_TOO_LARGE };
    }
    const minted = await createUploadUrl({
      environmentId,
      input: {
        type: "file",
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      },
    });
    const url =
      minted._tag === "Success" && httpBaseUrl !== null
        ? resolveAssetUrl(httpBaseUrl, minted.value.relativeUrl)
        : null;
    if (minted._tag !== "Success" || url === null) {
      return { problem: "Could not start the upload. Try again." };
    }
    const sent = await uploadPickedFile(url, file);
    return sent
      ? { id: minted.value.attachmentId }
      : { problem: "The upload did not arrive. Try again." };
  };

  const add = async () => {
    const endHandoff = beginForegroundHandoff();
    const picked = await pickFiles().finally(endHandoff);
    if (picked === null) return Dialog.alert("Could not open the file picker.");
    if (picked.length === 0) return;
    setAdding(true);
    const notes: Array<string> = [];
    for (const file of picked) {
      const { name } = file;
      const sent = await send(file);
      const added =
        "id" in sent
          ? await addTopicFile({
              environmentId,
              input: { ...where, attachmentId: sent.id, fileName: name },
            })
          : null;
      const problem = "problem" in sent ? sent.problem : added && failureMessage(added);
      if (problem) Dialog.alert(`Could not add ${name}`, problem);
      // A Markdown file is a note: it is not among the files, so say where it went.
      if (added?._tag === "Success" && isNoteFileName(added.value.name)) {
        notes.push(added.value.name);
      }
    }
    setAdding(false);
    if (notes.length > 0) {
      Dialog.alert(
        `${notes.join(", ")} ${notes.length === 1 ? "was" : "were"} added to this topic's notes`,
        "A Markdown file is a note, so it is not listed with the files.",
      );
    }
  };

  return (
    <Section title="Files">
      <FilePreviewModal
        source={shown?.source ?? null}
        onRequestClose={closeShown}
        onOpenError={(cause) => {
          closeShown();
          Dialog.alert("Could not open the file", nativeViewerErrorMessage(cause));
        }}
      />
      {rows.length === 0 ? <Muted>No files in this topic yet.</Muted> : null}
      {rows.map((row) => {
        const locked = row.kind === "private" && !mayUsePrivate;
        const detail = `${formatAttachmentSize(row.sizeBytes)} · ${topicFileDate(row.at, now)}`;
        return (
          <Row
            key={row.key}
            icon={row.kind === "private" ? { ios: "lock", android: "lock" } : "doc"}
            label={row.name}
            detail={row.kind === "private" ? `Private · ${detail}` : detail}
            accessibilityLabel={`Open ${row.name}`}
            busy={working === row.key}
            onPress={locked || working !== null ? undefined : () => void open(row)}
            onLongPress={row.kind === "file" && canChange ? () => remove(row) : undefined}
          />
        );
      })}
      {more === null ? null : <Muted>{more}</Muted>}
      {canChange ? (
        <Row
          icon="plus"
          label={adding ? "Adding…" : "Add a file"}
          detail={null}
          accessibilityLabel="Add a file to this topic"
          busy={adding}
          onPress={() => void add()}
        />
      ) : null}
      {rows.some((row) => row.kind === "file") && canChange ? (
        <Text className="pt-2 text-xs text-foreground-muted">
          Touch and hold a file to remove it.
        </Text>
      ) : null}
      {data.large ? (
        <Text className="pt-2 text-xs text-foreground-muted">
          Your notes folder is over 1 GB, so backups will take longer.
        </Text>
      ) : null}
    </Section>
  );
}
