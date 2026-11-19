import { Extension } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode, type Schema, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";

import { nextListMarker, styleNoteLines } from "./noteSource.logic";

/** A link in the note that was clicked: a Markdown link's address or a wiki link's note. */
export interface NoteSourceLink {
  readonly kind: "link" | "wiki";
  readonly target: string;
}

interface Callbacks {
  readonly onChange: (text: string) => void;
  readonly onBlur: () => void;
  readonly onOpenLink: (link: NoteSourceLink) => void;
}

const lookKey = new PluginKey<boolean>("noteSourceLook");

const docText = (doc: ProseMirrorNode) => doc.content.content.map((line) => line.textContent);

function linesDoc(schema: Schema, text: string): ProseMirrorNode {
  const paragraph = schema.nodes.paragraph!;
  return schema.nodes.doc!.create(
    null,
    text.split("\n").map((line) => paragraph.create(null, line === "" ? null : schema.text(line))),
  );
}

function checkbox(checked: boolean, editable: boolean, offsetToMark: number) {
  return (view: EditorView, getPos: () => number | undefined) => {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = checked;
    box.disabled = !editable;
    box.className = "note-source-checkbox";
    box.setAttribute("aria-label", checked ? "Done" : "To do");
    // Ticking must not move the caret onto the line, which would show its source instead.
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const pos = getPos();
      if (pos === undefined || !editable) return;
      const mark = pos + offsetToMark;
      view.dispatch(view.state.tr.insertText(checked ? " " : "x", mark, mark + 1));
    });
    return box;
  };
}

function lookDecorations(
  doc: ProseMirrorNode,
  input: {
    readonly active: (line: number) => boolean;
    readonly editable: boolean;
    readonly placeholder: string;
  },
): DecorationSet {
  const decorations: Array<Decoration> = [];
  const lines = styleNoteLines(docText(doc));
  const empty = doc.childCount === 1 && doc.firstChild!.content.size === 0;
  doc.forEach((node, offset, index) => {
    const line = lines[index]!;
    const start = offset + 1;
    const active = input.active(index);
    decorations.push(
      Decoration.node(offset, offset + node.nodeSize, {
        class: `note-source-${line.block}`,
        ...(empty ? { "data-placeholder": input.placeholder } : {}),
      }),
    );
    for (const span of line.spans) {
      if (span.from === span.to) continue;
      const hidden = span.kind === "syntax" && !active;
      const kind = span.kind === "bullet" && active ? "syntax" : span.kind;
      const linked = span.target !== undefined && span.target !== "" && !active;
      decorations.push(
        Decoration.inline(start + span.from, start + span.to, {
          class: hidden ? "note-source-hidden" : `note-source-${kind}`,
          ...(linked ? { "data-note-link": span.kind, "data-note-target": span.target } : {}),
        }),
      );
    }
    if (line.task !== null && !active) {
      // The box sits where the hidden `- [ ]` begins.
      const hiddenFrom = line.spans.find((span) => span.kind === "syntax")?.from ?? line.task.at;
      decorations.push(
        Decoration.widget(
          start + hiddenFrom,
          checkbox(line.task.checked, input.editable, line.task.at - hiddenFrom),
          { side: -1, key: `task-${line.task.checked}-${input.editable}` },
        ),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

function noteSourceExtension(callbacks: () => Callbacks, placeholder: string) {
  return Extension.create({
    name: "noteSource",
    addKeyboardShortcuts() {
      return {
        Enter: ({ editor }) => {
          const { state, view } = editor;
          const { $from, empty } = state.selection;
          if (!empty || $from.parentOffset !== $from.parent.content.size) return false;
          const next = nextListMarker($from.parent.textContent);
          if (next === null) return false;
          if (next === "clear") {
            view.dispatch(state.tr.delete($from.start(), $from.end()).scrollIntoView());
            return true;
          }
          const tr = state.tr.split($from.pos).insertText(next.marker, $from.pos + 2);
          tr.setSelection(TextSelection.create(tr.doc, $from.pos + 2 + next.marker.length));
          view.dispatch(tr.scrollIntoView());
          return true;
        },
      };
    },
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin<boolean>({
          key: lookKey,
          // Whether the editor has focus: source only shows on the caret's line while it does.
          state: {
            init: () => false,
            apply: (tr, focused) => (tr.getMeta(lookKey) as boolean | undefined) ?? focused,
          },
          props: {
            decorations(state) {
              const focused = lookKey.getState(state) === true && editor.isEditable;
              const first = state.selection.$from.index(0);
              const last = state.selection.$to.index(0);
              return lookDecorations(state.doc, {
                active: (line) => focused && line >= first && line <= last,
                editable: editor.isEditable,
                placeholder,
              });
            },
            handleDOMEvents: {
              focus: (view) => {
                view.dispatch(view.state.tr.setMeta(lookKey, true));
                return false;
              },
              blur: (view) => {
                view.dispatch(view.state.tr.setMeta(lookKey, false));
                callbacks().onBlur();
                return false;
              },
              mousedown: (_view, event) => {
                if (event.button !== 0) return false;
                const link = (event.target as Element).closest?.("[data-note-target]");
                const target = link?.getAttribute("data-note-target");
                if (!link || !target) return false;
                event.preventDefault();
                callbacks().onOpenLink({
                  kind: link.getAttribute("data-note-link") === "wiki" ? "wiki" : "link",
                  target,
                });
                return true;
              },
            },
            // Pasted text keeps its lines, blank ones included, and never its styling.
            handlePaste(view, event) {
              const text = event.clipboardData?.getData("text/plain");
              if (!text) return false;
              const pasted = linesDoc(view.state.schema, text.replaceAll(/\r\n?/g, "\n"));
              view.dispatch(
                view.state.tr
                  .replaceSelection(new Slice(Fragment.from(pasted.content), 1, 1))
                  .scrollIntoView(),
              );
              return true;
            },
            clipboardTextSerializer: (slice) =>
              slice.content.textBetween(0, slice.content.size, "\n"),
          },
        }),
      ];
    },
  });
}

/**
 * A note written as its own Markdown, shown the way it reads: headings, bold, links and checkboxes
 * look finished, and a line shows its markup only while the caret is on it. The text is never
 * converted, so what is saved is exactly what was typed.
 */
export function NoteSourceEditor({
  value,
  held,
  editable,
  placeholder,
  ariaLabel,
  onChange,
  onBlur,
  onOpenLink,
}: {
  /** The note as it is on disk. */
  readonly value: string;
  /** True while the editor holds changes not yet on disk, so `value` must not replace them. */
  readonly held: boolean;
  readonly editable: boolean;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly onChange: (text: string) => void;
  readonly onBlur: () => void;
  readonly onOpenLink: (link: NoteSourceLink) => void;
}) {
  const callbacks = useStableCallback((): Callbacks => ({ onChange, onBlur, onOpenLink }));
  const crlf = value.includes("\r\n");
  const eol = useRef(crlf);
  const [extensions] = useState(() => [
    StarterKit.configure({
      blockquote: false,
      bold: false,
      bulletList: false,
      code: false,
      codeBlock: false,
      dropcursor: false,
      gapcursor: false,
      hardBreak: false,
      heading: false,
      horizontalRule: false,
      italic: false,
      link: false,
      listItem: false,
      listKeymap: false,
      orderedList: false,
      strike: false,
      trailingNode: false,
      underline: false,
    }),
    noteSourceExtension(callbacks, placeholder),
  ]);
  const editor = useEditor({
    extensions,
    editable,
    content: "",
    editorProps: {
      attributes: {
        class: "note-source",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": ariaLabel,
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: updated }) => {
      callbacks().onChange(docText(updated.state.doc).join(eol.current ? "\r\n" : "\n"));
    },
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the editor owns its document; a note changed on disk is loaded into it
  useEffect(() => {
    if (held) return;
    const text = value.replaceAll("\r\n", "\n");
    if (docText(editor.state.doc).join("\n") === text) return;
    eol.current = crlf;
    const doc = linesDoc(editor.schema, text);
    editor.view.dispatch(
      editor.state.tr
        .replaceWith(0, editor.state.doc.content.size, doc.content)
        .setMeta("addToHistory", false)
        .setMeta("preventUpdate", true),
    );
  }, [editor, value, held, crlf]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the editor is told when writing becomes allowed or not
  useEffect(() => {
    editor.setEditable(editable, false);
  }, [editor, editable]);

  return <EditorContent editor={editor} />;
}
