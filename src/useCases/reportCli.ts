import type { CliIO } from "../io.js";

export function reportFailure(io: CliIO, json: boolean, message: string): number {
  const normalized = message.replace(/^Error:\s*/, "");
  if (json) {
    io.stdout(JSON.stringify({ ok: false, error: normalized }));
  } else {
    io.stderr(`Error: ${normalized}`);
  }
  return 1;
}

export function resolveReportInput<T>(
  io: CliIO,
  json: boolean,
  resolve: (captured: CliIO) => T | null,
): T | null {
  let diagnostic: string | undefined;
  const captured: CliIO = {
    stdout: io.stdout,
    stderr: (message) => {
      diagnostic = message;
    },
  };
  const result = resolve(captured);
  if (result === null) reportFailure(io, json, diagnostic ?? "unable to resolve report input");
  return result;
}

export function formatReportError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
