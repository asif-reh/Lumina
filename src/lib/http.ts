import { unstable_rethrow } from "next/navigation";

export function jsonOk(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function jsonError(status: number, code: string, message: string) {
  return Response.json(
    { error: code, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function fail(error: unknown) {
  unstable_rethrow(error);
  const message = error instanceof Error ? error.message : "Request failed.";
  const lower = message.toLowerCase();
  const status = lower.includes("not found")
    ? 404
    : lower.includes("invalid") ||
        lower.includes("escapes") ||
        lower.includes("not allowed") ||
        lower.includes("missing") ||
        lower.includes("empty") ||
        lower.includes("larger than")
      ? 400
      : 500;
  return jsonError(status, "request_failed", message);
}
