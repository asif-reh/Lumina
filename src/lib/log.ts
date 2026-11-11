const SECRET_KEY = /key|secret|token|authorization|password/i;
const SECRET_VALUE = /\b(?:sk|fc|or)-[A-Za-z0-9_-]{6,}\b/g;

function scrub(value: string): string {
  return value.replace(SECRET_VALUE, "[redacted]").slice(0, 400);
}

/** One JSON line on stdout/stderr. Key fields and key-shaped values are dropped. */
export function logEvent(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, string | number | boolean | null | undefined> = {},
) {
  const payload: Record<string, string | number | boolean | null> = {
    ts: new Date().toISOString(),
    level,
    event,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || SECRET_KEY.test(key)) continue;
    payload[key] = typeof value === "string" ? scrub(value) : value;
  }
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
