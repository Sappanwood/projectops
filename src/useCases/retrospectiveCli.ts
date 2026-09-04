import type { CliIO } from "../io.js";

export function retrospectiveFailure(io: CliIO, json: boolean, message: string): number {
  const normalized = message.replace(/^Error:\s*/, "");
  if (json) {
    io.stdout(JSON.stringify({ ok: false, error: normalized }));
  } else {
    io.stderr(`Error: ${normalized}`);
  }
  return 1;
}

export function formatRetrospectiveError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
