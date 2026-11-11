const CITE_COMMAND =
  /\\(?:cite|Cite|citep|citet|citealp|citealt|Citep|Citet|autocite|Autocite|textcite|Textcite|parencite|Parencite|footcite|supercite|smartcite|citeauthor|citeyear|Citeauthor)(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]+)\}/g;

export function extractCitationKeys(tex: string): string[] {
  const keys: string[] = [];
  for (const match of tex.matchAll(CITE_COMMAND)) {
    const group = match[1] ?? "";
    for (const raw of group.split(",")) {
      const key = raw.trim();
      if (key) keys.push(key);
    }
  }
  return keys;
}

export function extractBibliographyRefs(tex: string): string[] {
  const refs: string[] = [];
  const patterns = [
    /\\bibliography\s*\{([^{}]+)\}/g,
    /\\addbibresource\s*(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g,
  ];
  for (const pattern of patterns) {
    for (const match of tex.matchAll(pattern)) {
      for (const raw of (match[1] ?? "").split(",")) {
        const name = raw.trim().replace(/\.bib$/i, "");
        if (name) refs.push(name);
      }
    }
  }
  return refs;
}

export function findTexRoot(files: { path: string; text: string }[]): string | undefined {
  for (const file of files) {
    const magic = file.text.match(/%\s*!TEX\s+root\s*=\s*(\S+)/i);
    if (magic?.[1]) return magic[1].replaceAll("\\", "/");
  }
  return undefined;
}
