"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import {
  Briefcase,
  FilePlus,
  FolderOpen,
  Loader2,
  Quote,
  Settings,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { AssistantPane } from "@/components/assistant-pane";
import { CitationDialog } from "@/components/citation-dialog";
import { JobFitDialog } from "@/components/job-fit-dialog";
import { FileTree } from "@/components/file-tree";
import { LatexEditor, type EditorSelection } from "@/components/latex-editor";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ApiError, api } from "@/lib/api";
import { readLastProject, requestHeaders, writeLastProject } from "@/lib/client-settings";
import type { CitationReport, CompileResponse, FileNode, LogDiagnostic, ProjectSummary } from "@/lib/types";

type ProjectPayload = {
  project: ProjectSummary;
  tree: FileNode[];
  diagnostics: LogDiagnostic[];
  log: string;
};

type Pane = "write" | "preview" | "assistant";

export function Workspace() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [binaryUrl, setBinaryUrl] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const [diagnostics, setDiagnostics] = useState<LogDiagnostic[]>([]);
  const [pdfVersion, setPdfVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [saving, setSaving] = useState<"saved" | "dirty" | "saving">("saved");
  const [pane, setPane] = useState<Pane>("write");
  const [filesOpen, setFilesOpen] = useState(false);
  const [jump, setJump] = useState<{ line: number; nonce: number } | null>(null);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [fileOpen, setFileOpen] = useState(false);
  const [fileName, setFileName] = useState("sections/notes.tex");
  const [citationsOpen, setCitationsOpen] = useState(false);
  const [jobFitOpen, setJobFitOpen] = useState(false);
  const [report, setReport] = useState<CitationReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [citationError, setCitationError] = useState<string | null>(null);
  const [seed, setSeed] = useState<{ id: number; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const draft = useRef({ path: "", content: "", saved: "" });
  const projectRef = useRef(project);
  const binaryRef = useRef(binaryUrl);
  projectRef.current = project;
  binaryRef.current = binaryUrl;

  const refreshList = useCallback(async () => {
    const data = await api<{ projects: ProjectSummary[] }>("/api/projects");
    setProjects(data.projects);
    return data.projects;
  }, []);

  const openFile = useCallback(async (id: string, path: string) => {
    await flushSave();
    const response = await fetch(`/api/projects/${id}/file?path=${encodeURIComponent(path)}`);
    if (response.status === 415) {
      draft.current = { path, content: "", saved: "" };
      setOpenPath(path);
      setContent("");
      setBinaryUrl(`/api/projects/${id}/raw?path=${encodeURIComponent(path)}&v=${Date.now()}`);
      setSaving("saved");
      return;
    }
    const data = (await response.json()) as { content?: string; message?: string };
    if (!response.ok) throw new ApiError(data.message || "Could not open that file.", response.status);
    const text = data.content ?? "";
    draft.current = { path, content: text, saved: text };
    setOpenPath(path);
    setContent(text);
    setBinaryUrl(null);
    setSaving("saved");
  }, []);

  const loadProject = useCallback(
    async (id: string) => {
      const data = await api<ProjectPayload>(`/api/projects/${id}`);
      setProject(data.project);
      setTree(data.tree);
      setLog(data.log);
      setDiagnostics(data.diagnostics);
      setPdfVersion(data.project.hasPdf ? Date.now() : 0);
      writeLastProject(id);
      await openFile(id, data.project.mainFile);
    },
    [openFile],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await refreshList();
        if (cancelled) return;
        const preferred = readLastProject();
        const initial = list.find((item) => item.id === preferred) ?? list[0];
        if (!initial) {
          setLoadError("No project is on disk. Create one to begin.");
          return;
        }
        await loadProject(initial.id);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Could not open Lumina.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProject, refreshList]);

  async function flushSave() {
    const currentProject = projectRef.current;
    const current = draft.current;
    if (!currentProject || !current.path || current.content === current.saved || binaryRef.current) return;
    setSaving("saving");
    await api(`/api/projects/${currentProject.id}/file`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: current.path, content: current.content }),
    });
    draft.current.saved = current.content;
    setSaving("saved");
  }

  useEffect(() => {
    if (!project || !openPath || binaryUrl || content === draft.current.saved) return;
    draft.current.path = openPath;
    draft.current.content = content;
    setSaving("dirty");
    const timer = window.setTimeout(() => {
      void flushSave().catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : "Could not save.");
      });
    }, 700);
    return () => window.clearTimeout(timer);
    // flushSave closes over project; the timer only needs the latest draft ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, openPath, project?.id, binaryUrl]);

  async function compile() {
    if (!project) return;
    setCompiling(true);
    setPane("preview");
    try {
      await flushSave();
      const result = await api<CompileResponse>(`/api/projects/${project.id}/compile`, { method: "POST" });
      setLog(result.log);
      setDiagnostics(result.diagnostics);
      if (result.pdfAvailable) setPdfVersion(Date.now());
      setProject((current) => (current ? { ...current, hasPdf: result.pdfAvailable } : current));
      if (result.success) toast.success(`Compiled in ${(result.elapsedMs / 1000).toFixed(1)}s`);
      else toast.error("Compile finished with errors. The log is under the editor.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Compile failed to start.");
    } finally {
      setCompiling(false);
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flushSave().then(() => toast.success("Saved")).catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : "Could not save.");
        });
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void compile();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, binaryUrl]);

  async function importZip(file: File) {
    const body = new FormData();
    body.append("file", file);
    body.append("name", file.name.replace(/\.zip$/i, ""));
    const response = await fetch("/api/projects/import", { method: "POST", body });
    const data = (await response.json()) as {
      project?: ProjectSummary;
      warnings?: string[];
      message?: string;
    };
    if (!response.ok || !data.project) throw new ApiError(data.message || "Import failed.", response.status);
    if (data.warnings?.length) toast.message(data.warnings[0] ?? "Imported.");
    else toast.success(`Imported ${data.project.name}`);
    await refreshList();
    await loadProject(data.project.id);
  }

  async function createNamedProject(seed: "blank" | "cv" = "blank") {
    const created = await api<{ project: ProjectSummary }>("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, seed }),
    });
    setNewOpen(false);
    setNewName("");
    await refreshList();
    await loadProject(created.project.id);
  }

  async function createFile() {
    if (!project) return;
    const path = fileName.trim();
    const starter = path.endsWith(".bib")
      ? "% Add bibliography entries here.\n"
      : "% New file\n";
    await api(`/api/projects/${project.id}/file`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content: starter }),
    });
    setFileOpen(false);
    const data = await api<ProjectPayload>(`/api/projects/${project.id}`);
    setTree(data.tree);
    await openFile(project.id, path);
  }

  async function jumpTo(file: string | undefined, line: number | undefined) {
    if (!project) return;
    if (file && file !== openPath) {
      try {
        await openFile(project.id, file.replace(/^\.\//, ""));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not open the file named in the log.");
      }
    }
    if (line) setJump({ line, nonce: Date.now() });
    setPane("write");
  }

  const errors = diagnostics.filter((item) => item.severity === "error");

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-desk text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Opening the desk…
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-desk px-6 text-center">
        <p className="font-display text-3xl text-ink">Lumina</p>
        <p className="max-w-md text-sm leading-6 text-muted-foreground">
          {loadError ?? "Create a project or import a ZIP of LaTeX sources to begin."}
        </p>
        <div className="flex gap-2">
          <Button type="button" onClick={() => setNewOpen(true)}>
            New project
          </Button>
          <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
            Import ZIP
          </Button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importZip(file).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Import failed."));
          }}
        />
        <NewProjectDialog open={newOpen} name={newName} setName={setNewName} setOpen={setNewOpen} onCreate={(seed) => void createNamedProject(seed).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not create the project."))} />
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-desk text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 bg-ink px-3 text-paper">
        <Link href="/" className="flex items-center gap-2 pr-1">
          <LampMark />
          <span className="font-display text-xl leading-none tracking-tight">Lumina</span>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger className="max-w-[220px] truncate rounded-md px-2 py-1 text-sm text-paper/90 hover:bg-white/10">
            {project.name}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {projects.map((item) => (
              <DropdownMenuItem key={item.id} onClick={() => void loadProject(item.id).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not open the project."))}>
                <span className="truncate">{item.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" className="text-paper hover:bg-white/10 hover:text-paper" onClick={() => setNewOpen(true)}>
            <FilePlus /> <span className="hidden sm:inline">New</span>
          </Button>
          <Button type="button" size="sm" variant="ghost" className="text-paper hover:bg-white/10 hover:text-paper" onClick={() => fileInput.current?.click()}>
            <Upload /> <span className="hidden sm:inline">Import</span>
          </Button>
          <Button type="button" size="sm" className="bg-lumina text-lumina-foreground hover:bg-lumina/90" onClick={() => void compile()} disabled={compiling}>
            {compiling ? <Loader2 className="animate-spin" /> : null}
            {compiling ? "Compiling" : "Compile"}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="text-paper hover:bg-white/10 hover:text-paper" onClick={() => setJobFitOpen(true)}>
            <Briefcase /> <span className="hidden md:inline">Job Fit</span>
          </Button>
          <Button type="button" size="sm" variant="ghost" className="text-paper hover:bg-white/10 hover:text-paper" onClick={() => setCitationsOpen(true)}>
            <Quote /> <span className="hidden md:inline">Citations</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-paper hover:bg-white/10 hover:text-paper"
            onClick={() => {
              void api<{ notes: string[]; graph: string }>(`/api/projects/${project.id}/index`, {
                method: "POST",
                headers: requestHeaders(),
              })
                .then((result) => toast.success(result.notes[0] ?? result.graph))
                .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Indexing failed."));
            }}
          >
            <span className="hidden lg:inline">Index</span>
          </Button>
          <Link
            href="/settings"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-paper hover:bg-white/10 hover:text-paper")}
          >
            <Settings /> <span className="hidden md:inline">Settings</span>
          </Link>
        </div>
      </header>

      <div className="flex border-b border-border bg-paper px-2 py-1 xl:hidden">
        <Button type="button" size="xs" variant={filesOpen ? "secondary" : "ghost"} onClick={() => setFilesOpen(true)}>
          <FolderOpen /> Files
        </Button>
        {(["write", "preview", "assistant"] as const).map((item) => (
          <Button key={item} type="button" size="xs" variant={pane === item ? "secondary" : "ghost"} onClick={() => setPane(item)}>
            {item === "write" ? "Editor" : item === "preview" ? "PDF" : "Assistant"}
          </Button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className={`${filesOpen ? "absolute z-30 flex h-[calc(100dvh-3rem)] shadow-xl md:static md:h-auto md:shadow-none" : "hidden"} w-60 shrink-0 flex-col bg-ink md:flex`}>
          <div className="flex items-center justify-between px-3 py-2 text-[11px] tracking-wide text-paper/50 uppercase">
            Files
            <button type="button" className="text-paper/70 hover:text-paper" onClick={() => setFileOpen(true)}>
              <FilePlus className="size-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-1 pb-3">
            <FileTree
              nodes={tree}
              activePath={openPath}
              mainFile={project.mainFile}
              onOpen={(path) => {
                setFilesOpen(false);
                setPane("write");
                void openFile(project.id, path).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not open the file."));
              }}
              onSetMain={(path) => {
                void api(`/api/projects/${project.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ mainFile: path }),
                })
                  .then(() => {
                    setProject((current) => (current ? { ...current, mainFile: path } : current));
                    toast.success(`${path} is the main document.`);
                  })
                  .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not change the main file."));
              }}
              onDelete={(path) => {
                if (!window.confirm(`Delete ${path}?`)) return;
                void api(`/api/projects/${project.id}/file?path=${encodeURIComponent(path)}`, { method: "DELETE" })
                  .then(async () => {
                    const data = await api<ProjectPayload>(`/api/projects/${project.id}`);
                    setTree(data.tree);
                    if (openPath === path) await openFile(project.id, project.mainFile);
                    toast.success(`Deleted ${path}`);
                  })
                  .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not delete the file."));
              }}
            />
          </div>
          <p className="border-t border-white/10 px-3 py-2 text-[11px] leading-4 text-paper/45">
            Main file: <span className="text-paper/80">{project.mainFile}</span>
          </p>
        </aside>
        {filesOpen && <button type="button" aria-label="Close files" className="fixed inset-0 z-20 bg-black/40 md:hidden" onClick={() => setFilesOpen(false)} />}

        <section className={`${pane === "write" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col xl:flex`}>
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-paper px-3 text-xs">
            <span className="truncate font-mono text-muted-foreground">{openPath}</span>
            <span className="text-muted-foreground">{saving === "dirty" ? "Unsaved" : saving === "saving" ? "Saving…" : "Saved"}</span>
          </div>
          <div className="min-h-0 flex-1 bg-[#FBF7F0]">
            {binaryUrl ? (
              <div className="flex h-full items-center justify-center p-6">
                {/\.(png|jpe?g|gif|svg|webp)$/i.test(openPath ?? "") ? (
                  // Binary figures are project files, not optimized app assets.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={binaryUrl} alt={openPath ?? "Figure"} className="max-h-full max-w-full object-contain shadow" />
                ) : (
                  <iframe title={openPath ?? "File"} src={binaryUrl} className="h-full w-full bg-white" />
                )}
              </div>
            ) : (
              <LatexEditor
                path={openPath ?? "main.tex"}
                value={content}
                diagnostics={diagnostics}
                jump={jump}
                onChange={(next) => {
                  draft.current.content = next;
                  setContent(next);
                }}
                onSelection={setSelection}
              />
            )}
          </div>
          <div className="h-40 shrink-0 border-t border-border bg-[#1C1915] text-[#F6F1E8]">
            <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-[#E7D7C3]">
              <span>{errors.length ? `${errors.length} error${errors.length === 1 ? "" : "s"}` : "Compile log"}</span>
              {errors.length > 0 && (
                <button
                  type="button"
                  className="rounded bg-lumina px-2 py-0.5 text-[11px] font-medium text-lumina-foreground"
                  onClick={() => {
                    setPane("assistant");
                    setSeed({
                      id: Date.now(),
                      text: "The latest compile failed. Read the compile log already in your context, propose the smallest patch that fixes it, and trial-compile until the sandbox build succeeds or you are blocked. Do not invent packages that are not needed.",
                    });
                  }}
                >
                  Fix with assistant
                </button>
              )}
            </div>
            <div className="h-[calc(100%-28px)] overflow-auto px-3 pb-2 font-mono text-[11px] leading-4">
              {errors.map((error, index) => (
                <button
                  key={`${error.file}-${error.line}-${index}`}
                  type="button"
                  className="mb-1 flex w-full items-start gap-1 text-left text-red-300 hover:underline"
                  onClick={() => void jumpTo(error.file, error.line)}
                >
                  <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                  <span>
                    {error.file ? `${error.file}${error.line ? `:${error.line}` : ""} — ` : ""}
                    {error.message}
                  </span>
                </button>
              ))}
              {log ? (
                <pre className="whitespace-pre-wrap text-[#E7D7C3]/80">{log.trim().split("\n").slice(-60).join("\n")}</pre>
              ) : (
                <p className="text-[#E7D7C3]/70">
                  Compile to typeset with Tectonic. The first run downloads the TeX bundle and can take a few minutes.
                  Errors that name a file and line are marked in the editor.
                </p>
              )}
            </div>
          </div>
        </section>

        <section className={`${pane === "preview" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col border-l border-border xl:flex xl:w-[38%] xl:flex-none`}>
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-paper px-3 text-xs">
            <span>PDF</span>
            {pdfVersion > 0 && (
              <a className="text-primary underline-offset-2 hover:underline" href={`/api/projects/${project.id}/pdf?v=${pdfVersion}`} download>
                Download
              </a>
            )}
          </div>
          <div className="min-h-0 flex-1 bg-desk p-3">
            {pdfVersion > 0 ? (
              <AnimatePresence mode="wait">
                <motion.iframe
                  key={pdfVersion}
                  title="Compiled PDF"
                  src={`/api/projects/${project.id}/pdf?v=${pdfVersion}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35 }}
                  className="h-full w-full rounded-md bg-white shadow-md"
                />
              </AnimatePresence>
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <p className="font-display text-2xl text-ink">No PDF yet</p>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                  Compile the open project to typeset it locally. If the engine is missing, run <code>npm run setup</code> and try again.
                </p>
              </div>
            )}
          </div>
        </section>

        <aside className={`${pane === "assistant" ? "flex" : "hidden"} min-h-0 w-full flex-col border-l border-border xl:flex xl:w-[340px] xl:flex-none`}>
          <AssistantPane
            projectId={project.id}
            selection={selection && openPath ? { ...selection, path: openPath } : null}
            seed={seed}
            onApplied={(files) => {
              const current = files.find((file) => file.path === openPath);
              if (current) {
                draft.current = { path: current.path, content: current.content, saved: current.content };
                setContent(current.content);
                setSaving("saved");
              }
              void api<ProjectPayload>(`/api/projects/${project.id}`).then((data) => setTree(data.tree));
            }}
            onCompiled={() => {
              void api<ProjectPayload>(`/api/projects/${project.id}`).then((data) => {
                setLog(data.log);
                setDiagnostics(data.diagnostics);
                if (data.project.hasPdf) setPdfVersion(Date.now());
              });
            }}
          />
        </aside>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void importZip(file).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Import failed."));
        }}
      />

      <NewProjectDialog
        open={newOpen}
        name={newName}
        setName={setNewName}
        setOpen={setNewOpen}
        onCreate={(seed) => void createNamedProject(seed).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not create the project."))}
      />

      <Dialog open={fileOpen} onOpenChange={setFileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New file</DialogTitle>
            <DialogDescription>Use a relative path. Folders are created as needed.</DialogDescription>
          </DialogHeader>
          <Input value={fileName} onChange={(event) => setFileName(event.target.value)} />
          <DialogFooter>
            <Button type="button" onClick={() => void createFile().catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not create the file."))}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <JobFitDialog
        open={jobFitOpen}
        onOpenChange={setJobFitOpen}
        projectId={project.id}
        beforeRun={flushSave}
        onApplied={(files) => {
          const current = files.find((file) => file.path === openPath);
          if (current) {
            draft.current = { path: current.path, content: current.content, saved: current.content };
            setContent(current.content);
            setSaving("saved");
          }
          void api<ProjectPayload>(`/api/projects/${project.id}`).then((data) => setTree(data.tree));
        }}
      />

      <CitationDialog
        open={citationsOpen}
        onOpenChange={setCitationsOpen}
        report={report}
        loading={checking}
        error={citationError}
        onCheck={() => {
          setChecking(true);
          setCitationError(null);
          void api<CitationReport>("/api/citations", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...requestHeaders() },
            body: JSON.stringify({ projectId: project.id }),
          })
            .then(setReport)
            .catch((error: unknown) => setCitationError(error instanceof Error ? error.message : "Citation check failed."))
            .finally(() => setChecking(false));
        }}
      />
    </div>
  );
}

function NewProjectDialog({
  open,
  name,
  setName,
  setOpen,
  onCreate,
}: {
  open: boolean;
  name: string;
  setName: (value: string) => void;
  setOpen: (open: boolean) => void;
  onCreate: (seed: "blank" | "cv") => void;
}) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Starts from a one-file article, or from the fictional sample CV used to try Job Fit. The sample note stays
            in the project list.
          </DialogDescription>
        </DialogHeader>
        <Input placeholder="Working title" value={name} onChange={(event) => setName(event.target.value)} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onCreate("cv")}>
            Sample CV
          </Button>
          <Button type="button" onClick={() => onCreate("blank")} disabled={!name.trim()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LampMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="7" fill="none" stroke="#F6F1E8" strokeWidth="1.2" />
      <path d="M4.5 9h9" stroke="#E2B15A" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="9" cy="9" r="1.4" fill="#E2B15A" />
    </svg>
  );
}
