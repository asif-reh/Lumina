import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { CompileResponse } from "@/lib/types";
import { parseCompileLog } from "@/lib/log-parse";
import { buildDir, ensureDir, filesDir, tectonicCacheDir } from "@/lib/paths";
import { readMeta } from "@/lib/projects";

let chain: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function resolveTectonicBin(): string | null {
  const candidates = [
    process.env.TECTONIC_BIN,
    path.join(process.cwd(), "tools", "tectonic"),
  ].filter((value): value is string => Boolean(value && value.trim()));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function runProcess(bin: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      env: {
        ...process.env,
        TECTONIC_CACHE_DIR: tectonicCacheDir(),
      },
    });
    let output = "";
    const append = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 400_000) output = output.slice(-400_000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Compilation timed out after 4 minutes."));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output });
    });
  });
}

function missingEngineMessage(): string {
  return [
    "Tectonic is not installed.",
    "From the repository root, run: npm run setup",
    "Or set TECTONIC_BIN to a tectonic executable.",
  ].join(" ");
}

async function tectonic(args: string[], cwd: string): Promise<{ code: number; output: string; bin: string }> {
  const bin = resolveTectonicBin();
  if (!bin) {
    throw new Error(missingEngineMessage());
  }
  try {
    const result = await runProcess(bin, args, cwd, 240_000);
    return { ...result, bin };
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(missingEngineMessage());
    }
    throw error;
  }
}

function persistResult(id: string, log: string, diagnostics: CompileResponse["diagnostics"]) {
  const dir = buildDir(id);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, "compile.log"), log);
  fs.writeFileSync(path.join(dir, "diagnostics.json"), JSON.stringify(diagnostics, null, 2));
}

export function compileProject(id: string): Promise<CompileResponse> {
  return withLock(async () => {
    const started = Date.now();
    const meta = readMeta(id);
    const source = filesDir(id);
    const mainAbs = path.join(source, meta.mainFile);
    if (!fs.existsSync(mainAbs)) {
      throw new Error(`Main file ${meta.mainFile} is missing.`);
    }
    const out = buildDir(id);
    ensureDir(out);
    const args = [
      "--color",
      "never",
      "--untrusted",
      "--keep-logs",
      "--print",
      "--outdir",
      out,
      meta.mainFile,
    ];
    const result = await tectonic(args, source);
    const logName = `${path.basename(meta.mainFile, path.extname(meta.mainFile))}.log`;
    const logFile = path.join(out, logName);
    const fileLog = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
    const log = [result.output.trim(), fileLog.trim()].filter(Boolean).join("\n\n");
    const diagnostics = parseCompileLog(log);
    const pdfName = `${path.basename(meta.mainFile, path.extname(meta.mainFile))}.pdf`;
    const pdfAvailable = fs.existsSync(path.join(out, pdfName));
    persistResult(id, log, diagnostics);
    return {
      success: result.code === 0 && pdfAvailable,
      pdfAvailable,
      log: log || (result.code === 0 ? "Tectonic finished without log output." : "Tectonic failed without log output."),
      diagnostics,
      engine: `tectonic (${path.basename(result.bin)})`,
      elapsedMs: Date.now() - started,
    };
  });
}

export function trialCompile(
  id: string,
  overlays: Map<string, string>,
): Promise<{ success: boolean; summary: string }> {
  return withLock(async () => {
    const meta = readMeta(id);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lumina-trial-"));
    try {
      fs.cpSync(filesDir(id), tmp, { recursive: true });
      for (const [relative, content] of overlays) {
        const full = path.join(tmp, relative);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
      }
      const out = path.join(tmp, "build");
      fs.mkdirSync(out, { recursive: true });
      const result = await tectonic(
        ["--color", "never", "--untrusted", "--print", "--outdir", out, meta.mainFile],
        tmp,
      );
      const pdfName = `${path.basename(meta.mainFile, path.extname(meta.mainFile))}.pdf`;
      const success = result.code === 0 && fs.existsSync(path.join(out, pdfName));
      const diagnostics = parseCompileLog(result.output).filter((item) => item.severity === "error");
      const excerpt = diagnostics
        .slice(0, 8)
        .map((item) => `${item.file ?? "log"}${item.line ? `:${item.line}` : ""}: ${item.message}`)
        .join("\n");
      const tail = result.output.trim().split("\n").slice(-30).join("\n");
      const summary = success
        ? "Trial compile succeeded. The project files are unchanged until the user accepts the patch."
        : `Trial compile failed.\n${excerpt || tail}`.slice(0, 4000);
      return { success, summary };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}
