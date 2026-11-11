"use client";

import { useEffect, useMemo, useRef } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { linter } from "@codemirror/lint";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { tags } from "@lezer/highlight";
import type { LogDiagnostic } from "@/lib/types";

const luminaTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "#FBF7F0",
      color: "#1C1915",
      fontSize: "14px",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-mono), ui-monospace, monospace",
      lineHeight: "1.55",
    },
    ".cm-content": {
      padding: "12px 0",
      caretColor: "#C9842A",
    },
    ".cm-gutters": {
      backgroundColor: "#F6F1E8",
      color: "#A39886",
      borderRight: "1px solid #E6DCCB",
    },
    ".cm-activeLine": { backgroundColor: "rgba(201, 132, 42, 0.08)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(201, 132, 42, 0.12)", color: "#6B5430" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "rgba(30, 77, 123, 0.16)",
    },
    ".cm-cursor": { borderLeftColor: "#C9842A" },
  },
  { dark: false },
);

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#1E4D7B" },
  { tag: tags.comment, color: "#8A8175", fontStyle: "italic" },
  { tag: tags.string, color: "#8A4B08" },
  { tag: tags.atom, color: "#7A3E12" },
  { tag: tags.meta, color: "#1E4D7B" },
]);

export type EditorSelection = {
  text: string;
  startLine: number;
  endLine: number;
};

type Jump = { line: number; nonce: number };

export function LatexEditor({
  path,
  value,
  diagnostics,
  jump,
  onChange,
  onSelection,
}: {
  path: string;
  value: string;
  diagnostics: LogDiagnostic[];
  jump: Jump | null;
  onChange: (value: string) => void;
  onSelection: (selection: EditorSelection | null) => void;
}) {
  const viewRef = useRef<EditorView | null>(null);

  const extensions = useMemo(
    () => [
      StreamLanguage.define(stex),
      syntaxHighlighting(highlight),
      luminaTheme,
      EditorView.lineWrapping,
      linter((view) =>
        diagnostics.flatMap((item) => {
          if (item.severity !== "error" || !item.line || !item.file) return [];
          if (item.file !== path && !path.endsWith(`/${item.file}`) && !item.file.endsWith(`/${path}`)) {
            return [];
          }
          const lineNo = Math.min(Math.max(item.line, 1), view.state.doc.lines);
          const line = view.state.doc.line(lineNo);
          return [
            {
              from: line.from,
              to: line.to,
              severity: "error" as const,
              message: item.message,
            },
          ];
        }),
      ),
    ],
    [diagnostics, path],
  );

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !jump?.line) return;
    const lineNo = Math.min(Math.max(jump.line, 1), view.state.doc.lines);
    const line = view.state.doc.line(lineNo);
    view.dispatch({
      selection: { anchor: line.from },
      scrollIntoView: true,
    });
    view.focus();
  }, [jump]);

  return (
    <CodeMirror
      className="h-full overflow-hidden [&_.cm-editor]:h-full"
      value={value}
      height="100%"
      theme="light"
      extensions={extensions}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: true,
        bracketMatching: true,
      }}
      onCreateEditor={(view) => {
        viewRef.current = view;
      }}
      onChange={onChange}
      onUpdate={(update) => {
        if (!update.selectionSet) return;
        const range = update.state.selection.main;
        if (range.empty) {
          onSelection(null);
          return;
        }
        onSelection({
          text: update.state.sliceDoc(range.from, range.to),
          startLine: update.state.doc.lineAt(range.from).number,
          endLine: update.state.doc.lineAt(range.to).number,
        });
      }}
    />
  );
}
