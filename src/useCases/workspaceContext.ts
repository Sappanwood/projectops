// Shared helper: load the workspace or report the error to the user.

import type { CliIO } from "../io.js";
import type { WorkspaceManifest } from "../catalog/workspace.js";
import {
  ManifestParseError,
  WorkspaceNotFoundError,
  loadWorkspace,
} from "../catalog/workspaceStore.js";

export function loadOrReport(
  startDir: string,
  io: CliIO,
): { root: string; manifest: WorkspaceManifest } | null {
  try {
    return loadWorkspace(startDir);
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError || error instanceof ManifestParseError) {
      io.stderr(`Error: ${error.message}`);
      return null;
    }
    throw error;
  }
}
