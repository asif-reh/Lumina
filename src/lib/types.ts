export type FileNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
};

export type ProjectMeta = {
  id: string;
  name: string;
  mainFile: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSummary = ProjectMeta & {
  hasPdf: boolean;
};

export type LogDiagnostic = {
  severity: "error" | "warning";
  file?: string;
  line?: number;
  message: string;
};

export type CompileResponse = {
  success: boolean;
  pdfAvailable: boolean;
  log: string;
  diagnostics: LogDiagnostic[];
  engine: string;
  elapsedMs: number;
};

export type PatchHunk = {
  search: string;
  replace: string;
  replaceAll?: boolean;
};

export type FilePatch = {
  path: string;
  description?: string;
  newFile?: boolean;
  content?: string;
  hunks?: PatchHunk[];
};

export type ProposedPatch = FilePatch & {
  diff: string;
};

export type CitationSource = "crossref" | "openalex" | "arxiv" | "semanticscholar";

export type CitationStatus =
  | "verified"
  | "mismatch"
  | "unverified"
  | "missing"
  | "lookup_failed";

export type CitationItem = {
  key: string;
  title?: string;
  year?: string;
  doi?: string;
  status: CitationStatus;
  detail: string;
  source?: CitationSource;
  matchedTitle?: string;
  matchedYear?: string;
  url?: string;
  inBibliography: boolean;
  cited: boolean;
};

export type CitationReport = {
  checkedAt: string;
  items: CitationItem[];
  counts: Record<CitationStatus, number>;
  warnings: string[];
  truncated: boolean;
};

export type AssistantSelection = {
  path: string;
  text: string;
  startLine: number;
  endLine: number;
};

export type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
};

export type TrialCompile = {
  success: boolean;
  summary: string;
};

export type AssistantResponse = {
  message: string;
  patches: ProposedPatch[];
  trial: TrialCompile | null;
  model: string;
};

export type SourceProposal = {
  id: string;
  title: string;
  authors?: string;
  year?: string;
  url?: string;
  doi?: string;
  abstract?: string;
  bibtex?: string;
  markdown?: string;
  origin: "firecrawl" | "zotero" | "upload";
};
