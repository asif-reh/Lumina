# Lumina

Lumina is a self-hosted workspace for scientific manuscripts. It keeps a multi-file LaTeX project on your machine, compiles it with [Tectonic](https://tectonic-typesetting.github.io/), and can ask an OpenAI model to propose edits. Those edits show up as diffs. Nothing is overwritten until you accept them.

Hosted LaTeX editors have been shut down before, and the export that survives is usually a ZIP of sources, figures, and bibliographies — not comments, permissions, or a live reference-manager session. Lumina is a place to keep writing after that kind of export, and to start new papers the same way. It is not the only editor with an assistant or ZIP import. The part that is specific here is that the files, the TeX engine, and the decision to apply a patch stay under your control, with your own API key.

## What you can do

- Edit a multi-file project (file tree, CodeMirror, PDF preview, compile log). Errors that name a file and a line are marked in the editor. The PDF pane and review cards use Motion; the editor itself does not animate while you type.
- Compile with Tectonic. Shell escape is disabled (`--untrusted`).
- Import an Overleaf-style or similar ZIP. Folder structure is kept, a main file is chosen (`main.tex`, a `\documentclass`, or a `% !TEX root` comment), and conversation JSON is left out.
- Ask the assistant, which streams through the Vercel AI SDK on the official OpenAI API (or OpenRouter if you switch providers). It proposes diffs, can trial-compile, and shows tool calls as they run.
- Index the project. LlamaIndex splits the sources. Embeddings go to Postgres with pgvector when `DATABASE_URL` is set, to Pinecone when that key and host are set, and otherwise to a local file index under `data/indexes`.
- Check bibliography entries against Crossref, OpenAlex, Semantic Scholar, and arXiv. A row is **verified** only when a public record agrees. The same result updates the project graph.
- Run **Job Fit** on the open project. Paste a job description, or give a posting URL when a Firecrawl key is set. Lumina lists what the project already supports, flags the gaps, and proposes TeX you accept. It does not invent jobs, skills, publications, or metrics.

A sample note is created the first time you open the app. It cites four real works (Knuth and Plass 1981, Lamport's LaTeX manual, the FAIR principles, and Vaswani et al. 2017) and one synthetic entry, `luminaDemoUnverifiable2099`. With network access, the four real entries verify and the synthetic one stays unverified.

## Run it locally

Requirements: Node.js 20.9 or newer, and a Tectonic binary.

```bash
npm install
npm run setup          # downloads Tectonic 0.17 into tools/tectonic
npm run dev            # http://127.0.0.1:43123
```

`npm run setup` picks a pinned build for Linux x64/arm64 and macOS x64/arm64. The Linux builds are static musl binaries, so they do not depend on the host glibc. If your platform is not listed, install Tectonic yourself and set `TECTONIC_BIN`.

The first compile downloads the Tectonic package bundle into `data/tectonic-cache`. That can take a few minutes. Later compiles reuse the cache.

Projects live in `data/projects/` (gitignored). The sample sources that get copied in are in `sample-project/`.

```bash
docker compose up -d   # optional Postgres + pgvector on port 54329
npm test
npm run lint
npm run typecheck
```

`docker compose up -d` starts only Postgres. It does not start the app. The production profile is described under [Run the Docker image](#run-the-docker-image).

## Keys

Open **Settings**. Every field is optional. Chat needs either an OpenAI key or, if the provider is OpenRouter, an OpenRouter key. Keys live in `localStorage` and are sent as request headers. The server does not write them into the project folder.

| Key | Unlocks |
| --- | --- |
| OpenAI | Assistant (default), embeddings, figure-to-LaTeX |
| OpenRouter | Assistant chat through another vendor. Embeddings still use OpenAI |
| LlamaCloud | LlamaParse for uploaded PDFs. Without it, PDFs use the local `unpdf` extractor |
| Pinecone key + host | Vector index in Pinecone instead of pgvector or the local file |
| Firecrawl | Search, scrape a URL you provide, and extract title/authors/abstract/DOI. Also scrapes a job posting URL for Job Fit. You accept bibliography items before they are saved |
| Zotero key + user id | Search your library and accept items into the `.bib` |
| Semantic Scholar | Higher rate limit. Checks run without it |
| Langfuse public + secret + host | Traces for the assistant, tool calls, and token estimates. Missing keys skip tracing |

`DATABASE_URL` is server configuration, not a browser key. With Docker:

```bash
docker compose up -d
# postgres://lumina:lumina@127.0.0.1:54329/lumina
```

If it is unset, **Index** still builds the citation graph and stores embeddings in `data/indexes`, and the UI says so.

`.env.local` can hold the same names for a single-user machine. A header from the browser wins. Do not commit `.env.local`.

Lumina is single-user bring-your-own-key. There is no account system in this version. Do not put the process on the public internet unless a network boundary you control sits in front of it.

## Job Fit

Open a project and choose **Job Fit** in the header. **New → Sample CV** copies `sample-cv/`, a fictional research-engineer resume, so you can try this without a private CV. Nothing in that folder is a real person's data.

1. Paste the job description, or paste a posting URL.
2. A URL is scraped with Firecrawl when that key is present. If you only pasted text, or Firecrawl is missing, the pasted text is read with the OpenAI or OpenRouter key. A missing key turns off only that path and says so in the dialog. The editor, compile, and the other key still work.
3. Requirements (role, must-haves, nice-to-haves, keywords, constraints) are extracted from the posting. The model is told not to add requirements the posting does not state.
4. Evidence comes from this project: the same LlamaIndex chunker Index uses, the vector index when an OpenAI embedding key and an index exist (pgvector, Pinecone, or `data/indexes`), and graph memory. There is no second retrieval store.
5. Covered requirements name the file and the passage. Gaps are requirements with no supporting passage, including metrics that never appear in the project.
6. Proposed edits are a reorder of existing resume bullets and, if you leave it checked, a new `job-fit/cover-letter.tex` whose bullets are copied from the project. Gaps are TeX comments, not claims. Nothing is written until you accept. A trial compile, when Tectonic is installed, uses a sandbox and does not replace the PDF.

The assistant has a `job_fit` tool that follows the same path. Accept or reject those diffs like any other patch.

Example posting against the sample CV: must-haves Postgres, pgvector, TypeScript, and retrieval evaluation should be covered. Kubernetes, or "5 years leading a team of 12", should be gaps. Job Fit will not add them.

## Import a ZIP

Use **Import** and choose a `.zip` of a LaTeX project (the kind of archive an Overleaf project or a Prism export produces: `.tex`, figures, `.bib`). Lumina:

- unwraps a single top-level folder
- skips `__MACOSX`, build junk (`.aux`, `.log`, `.bbl`, …), and folders named `conversations`, `conversation`, `chat`, or `chats`
- skips JSON files that look like chat transcripts, even at the archive root
- keeps other JSON, such as a data file
- refuses paths that escape the archive

After import, set a different main file from the star control on a `.tex` file if the guess is wrong.

## Citation check

**Citations** parses every `.bib` file and every `\cite` / `\citep` / `\citet` / `\autocite` / `\textcite` key. For each entry it tries, in order:

1. Crossref, when a DOI is present. A resolved DOI whose title does not agree is a **mismatch**, not a verification.
2. arXiv, when an eprint id is present.
3. A title search on Crossref, then OpenAlex, then Semantic Scholar, then arXiv.

Verification requires a strong title overlap plus a compatible year and, unless the title is nearly exact, the first author's family name. A close-but-not-quite hit is shown as unverified, with the closest public title, and is not marked verified. If a request fails, the row is **could not check** rather than unverified.

## Keyboard

- `Cmd/Ctrl+S` saves the open file (it also autosaves)
- `Cmd/Ctrl+Enter` compiles
- `Cmd/Ctrl+Enter` in the assistant box sends the message

## Intelligence layer

- **Motion** animates the PDF after compile, diff cards, citation rows, and settings sections.
- **Vercel AI SDK** streams the assistant. Tools cover reviewable patches, a real Tectonic compile, a sandbox trial compile, project indexing, retrieval, graph queries, citation checks, Firecrawl, Zotero, and figure-to-LaTeX.
- **LlamaIndex** `SentenceSplitter` chunks project text, accepted notes, and parsed PDFs before they are embedded.
- **Graph memory** stores papers, authors, citations, claims, and evidence sentences. The assistant can ask which citations are unverified and what supports a claim. A citation check rewrites this graph.
- **Index** in the header rebuilds vectors and the graph. Accepting a Firecrawl or Zotero card writes a `.bib` entry or `sources/*.md` and reindexes.
- **Langfuse** records the assistant generation, tool spans, and a rough USD estimate from published token prices. With no keys, the turn still completes and says tracing was skipped. Job Fit uses the same optional trace.
- **Job Fit** is ingest, then extract, then retrieve, then reviewable patches, then an optional sandbox compile. Logs for that path are JSON lines. Fields that look like keys are redacted. A failed scrape or a missing engine does not wipe the project.

## Limitations

- No accounts. Anyone who can reach the server can read and compile projects. Single-user bring-your-own-key is the current model. Keep it on localhost, or behind a network boundary you control.
- Vercel serverless is a poor fit. Tectonic needs a real process and a writable TeX cache, and projects live on the local filesystem. Use the Docker image on a single long-running service instead.
- No realtime collaboration, comments, or version history.
- Zotero search inserts items you accept. It does not keep a live two-way sync.
- Whisper transcription is not in this pass. Figure images already in the project can be sent to the vision tool.
- Keys in `localStorage` are visible to scripts on this origin. Fine for a local single-user app, a poor fit for a public host.
- Tectonic runs with shell escape off.
- Citation checks need outbound HTTPS. A failed lookup is reported per row and is not marked verified.
- The editor is CodeMirror. Trial compiles and accepted patches stay reviewable.
- The local vector file is the fallback when Postgres and Pinecone are both absent. It is not a shared service.

## Later

- Shared sessions and an explicit history of accepted patches
- Continuous Zotero sync
- Whisper for dictated prose
- Optional shell-escape compiles, off by default

## Layout

```
src/app/api/                 projects, compile, import, assistant stream, citations, index, memory, sources, job fit, health
src/lib/intelligence/        credentials, LlamaIndex chunking, vectors, graph, Firecrawl, Zotero, Langfuse, PDF extract
src/lib/job-fit/             posting ingest, requirement extract, grounding, reviewable TeX
src/components/              desk UI
docker-compose.yml           Postgres with pgvector; prod profile adds the app
sample-project/              the note copied into a new data directory
sample-cv/                   fictional CV for Job Fit
Dockerfile                   production image (Next.js server + Tectonic)
```

## Run the Docker image

The image is one long-running Node process. It installs Tectonic with `scripts/setup-tectonic.sh` and does not contain API keys.

```bash
docker build -t lumina .
docker run --rm -p 43123:43123 -v lumina-data:/data lumina
```

Open http://127.0.0.1:43123 and put keys in Settings, the same as a local checkout. The volume at `/data` holds projects, the local vector index, graph memory, and the Tectonic package cache (`/data/tectonic-cache`).

App and Postgres together:

```bash
cp .env.example .env   # optional server overrides; leave keys empty to use Settings
docker compose --profile prod up -d --build
```

`DATABASE_URL` inside that profile points at the Compose network, not at `127.0.0.1`. The published app port is still 43123. Postgres remains on host port 54329 for `npm run dev`. `GET /api/health` returns process health, whether a Tectonic binary is visible, and whether `DATABASE_URL` is set. It does not report secrets.

### Railway or Fly.io

Deploy this same Dockerfile as one service. Do not auto-wire a serverless adapter.

- The process listens on `PORT` and `HOSTNAME` (the image defaults to `43123` and `0.0.0.0`). Railway and Fly set `PORT`; the standalone server uses that value.
- Mount a persistent volume at `/data` and set `LUMINA_DATA_DIR=/data`.
- Set `DATABASE_URL` to a Postgres service with the pgvector extension when you want that index. When it is unset, embeddings stay in `/data/indexes`.
- Leave API keys empty on the host and paste them in Settings, or set the names from `.env.example` as optional server overrides. Do not bake keys into the image.
- Health check path: `/api/health`.

Vercel serverless will not run this image well. Compile and the project files need the long-running process and the disk above.
