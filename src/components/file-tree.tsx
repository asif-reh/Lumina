"use client";

import { useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, File, FileText, Folder, ImageIcon, Star, Trash2 } from "lucide-react";
import type { FileNode } from "@/lib/types";
import { cn } from "@/lib/utils";

function FileGlyph({ name }: { name: string }) {
  const className = "size-3.5 shrink-0";
  if (name.endsWith(".bib")) return <BookOpen className={className} />;
  if (/\.(png|jpe?g|gif|svg|webp|pdf)$/i.test(name)) return <ImageIcon className={className} />;
  if (/\.(tex|ltx)$/i.test(name)) return <FileText className={className} />;
  return <File className={className} />;
}

function TreeNodes({
  nodes,
  depth,
  activePath,
  mainFile,
  onOpen,
  onSetMain,
  onDelete,
}: {
  nodes: FileNode[];
  depth: number;
  activePath: string | null;
  mainFile: string;
  onOpen: (path: string) => void;
  onSetMain: (path: string) => void;
  onDelete: (path: string) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => (
        <Node
          key={node.path}
          node={node}
          depth={depth}
          activePath={activePath}
          mainFile={mainFile}
          onOpen={onOpen}
          onSetMain={onSetMain}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}

function Node({
  node,
  depth,
  activePath,
  mainFile,
  onOpen,
  onSetMain,
  onDelete,
}: {
  node: FileNode;
  depth: number;
  activePath: string | null;
  mainFile: string;
  onOpen: (path: string) => void;
  onSetMain: (path: string) => void;
  onDelete: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  if (node.type === "dir") {
    return (
      <li>
        <button
          type="button"
          className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-[13px] text-paper/80 hover:bg-white/8"
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
          <Folder className="size-3.5 shrink-0 text-lumina" />
          <span className="truncate">{node.name}</span>
        </button>
        {open && node.children && (
          <TreeNodes
            nodes={node.children}
            depth={depth + 1}
            activePath={activePath}
            mainFile={mainFile}
            onOpen={onOpen}
            onSetMain={onSetMain}
            onDelete={onDelete}
          />
        )}
      </li>
    );
  }

  const active = node.path === activePath;
  const isMain = node.path === mainFile;
  const tex = /\.(tex|ltx)$/i.test(node.name);

  return (
    <li>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md pr-1 text-[13px]",
          active ? "bg-white/12 text-paper" : "text-paper/75 hover:bg-white/8",
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left" onClick={() => onOpen(node.path)}>
          <FileGlyph name={node.name} />
          <span className="truncate">{node.name}</span>
          {isMain && <Star className="size-3 shrink-0 fill-lumina text-lumina" />}
        </button>
        {tex && !isMain && (
          <button
            type="button"
            title="Set as main document"
            className="hidden rounded p-1 text-paper/50 hover:text-lumina group-hover:block"
            onClick={() => onSetMain(node.path)}
          >
            <Star className="size-3" />
          </button>
        )}
        {!isMain && (
          <button
            type="button"
            title="Delete file"
            className="hidden rounded p-1 text-paper/50 hover:text-red-300 group-hover:block"
            onClick={() => onDelete(node.path)}
          >
            <Trash2 className="size-3" />
          </button>
        )}
      </div>
    </li>
  );
}

export function FileTree({
  nodes,
  activePath,
  mainFile,
  onOpen,
  onSetMain,
  onDelete,
}: {
  nodes: FileNode[];
  activePath: string | null;
  mainFile: string;
  onOpen: (path: string) => void;
  onSetMain: (path: string) => void;
  onDelete: (path: string) => void;
}) {
  if (nodes.length === 0) {
    return <p className="px-3 py-4 text-sm text-paper/60">This project has no files yet.</p>;
  }
  return (
    <TreeNodes
      nodes={nodes}
      depth={0}
      activePath={activePath}
      mainFile={mainFile}
      onOpen={onOpen}
      onSetMain={onSetMain}
      onDelete={onDelete}
    />
  );
}
