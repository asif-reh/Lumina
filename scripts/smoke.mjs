const base = process.env.LUMINA_URL ?? "http://127.0.0.1:43123";

async function json(pathname, init) {
  const response = await fetch(base + pathname, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${pathname} ${response.status}: ${data.message || response.statusText}`);
  }
  return data;
}

const projects = await json("/api/projects");
const sample = projects.projects.find((item) => item.id === "sample-note") ?? projects.projects[0];
if (!sample) throw new Error("No project was seeded.");
console.log("project", sample.id, sample.name);

const main = await json(`/api/projects/${sample.id}/file?path=${encodeURIComponent("main.tex")}`);
if (!main.content.includes("\\documentclass")) throw new Error("Sample main.tex did not load.");

console.log("compiling sample…");
const compiled = await json(`/api/projects/${sample.id}/compile`, { method: "POST" });
console.log("compile", compiled.success, `${compiled.elapsedMs}ms`, compiled.engine);
if (!compiled.success) {
  console.log(compiled.log.slice(-2000));
  throw new Error("Sample paper did not compile.");
}

const pdf = await fetch(`${base}/api/projects/${sample.id}/pdf`);
const bytes = Buffer.from(await pdf.arrayBuffer());
if (!pdf.ok || bytes.subarray(0, 5).toString() !== "%PDF-") {
  throw new Error("PDF response was not a PDF.");
}
console.log("pdf bytes", bytes.length);

console.log("citation check…");
const report = await json("/api/citations", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ projectId: sample.id }),
});
console.log("counts", report.counts);
for (const item of report.items) {
  console.log(`- ${item.status}\t${item.key}\t${item.detail}`);
}
const synthetic = report.items.find((item) => item.key === "luminaDemoUnverifiable2099");
if (!synthetic) throw new Error("Synthetic bibliography entry was not checked.");
if (synthetic.status === "verified") throw new Error("Synthetic entry was marked verified.");
const verified = report.items.filter((item) => item.status === "verified").map((item) => item.key);
if (!verified.includes("wilkinson2016fair") && !verified.includes("knuth1981breaking")) {
  throw new Error("Expected a DOI-backed sample entry to verify.");
}

const assistant = await fetch(`${base}/api/assistant`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    projectId: sample.id,
    messages: [{ role: "user", content: "Rewrite the abstract." }],
  }),
});
const assistantBody = await assistant.json();
if (assistant.status !== 401 || assistantBody.error !== "missing_api_key") {
  throw new Error(`Assistant without a key returned ${assistant.status}: ${JSON.stringify(assistantBody)}`);
}
console.log("assistant without key:", assistantBody.message);

const { zipSync, strToU8 } = await import("fflate");
const zipped = zipSync({
  "Demo/main.tex": strToU8("\\documentclass{article}\n\\begin{document}\nImported.\n\\end{document}\n"),
  "Demo/sections/body.tex": strToU8("Body.\n"),
  "Demo/conversations/thread.json": strToU8(JSON.stringify({ messages: [{ role: "user", content: "hi" }] })),
});
const form = new FormData();
form.append("file", new Blob([zipped]), "demo.zip");
form.append("name", "Imported demo");
const importedResponse = await fetch(`${base}/api/projects/import`, { method: "POST", body: form });
const imported = await importedResponse.json();
if (!importedResponse.ok) throw new Error(imported.message || "Import failed.");
const opened = await json(`/api/projects/${imported.project.id}`);
const flat = JSON.stringify(opened.tree);
if (!flat.includes("main.tex") || !flat.includes("body.tex")) throw new Error(`Import tree missing sources: ${flat}`);
if (flat.includes("conversations") || flat.includes("thread.json")) throw new Error(`Conversation JSON was imported: ${flat}`);
console.log("imported", imported.project.id, "main", imported.mainFile);

const patched = await json(`/api/projects/${imported.project.id}/patches`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    patches: [
      {
        path: "main.tex",
        description: "Smoke patch",
        hunks: [{ search: "Imported.", replace: "Imported and patched." }],
      },
    ],
  }),
});
if (!patched.files[0]?.content.includes("Imported and patched.")) throw new Error("Patch did not apply.");
console.log("patch applied");

const broken = await json("/api/projects", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Broken note" }),
});
await json(`/api/projects/${broken.project.id}/file`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    path: "main.tex",
    content: "\\documentclass{article}\n\\begin{document}\n\\notacommand\n\\end{document}\n",
  }),
});
const failed = await json(`/api/projects/${broken.project.id}/compile`, { method: "POST" });
const errorCount = failed.diagnostics.filter((item) => item.severity === "error").length;
console.log("broken compile success", failed.success, "errors", errorCount);
if (failed.success || errorCount < 1) throw new Error("Broken project should surface a compile error.");

await fetch(`${base}/api/projects/${imported.project.id}`, { method: "DELETE" });
await fetch(`${base}/api/projects/${broken.project.id}`, { method: "DELETE" });
console.log("SMOKE OK");
