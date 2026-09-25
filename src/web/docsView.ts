import type { DocumentList, ProjectDocument } from "../docs/documentReader.js";
import { formatRoute } from "./router.js";
import type { AppError, RouteState } from "./types.js";

export type DocsState = {
  list: DocumentList | null;
  document: ProjectDocument | null;
  loading: boolean;
  error: AppError | null;
  listError: AppError | null;
};
export const emptyDocsState = (): DocsState => ({
  list: null,
  document: null,
  loading: false,
  error: null,
  listError: null,
});

type DocumentLibrary = "docs" | "research";

export function documentLink(
  url: string,
  route: RouteState,
  library: DocumentLibrary = "docs",
): string | null {
  if (/^[a-z][a-z\d+.-]*:|^\/|[\\\x00-\x1f]/i.test(url)) return null;
  const hash = url.indexOf("#");
  const rawPath = hash < 0 ? url : url.slice(0, hash);
  let section: string | undefined;
  let relative: string;
  try {
    relative = decodeURIComponent(rawPath);
    section = hash < 0 ? undefined : decodeURIComponent(url.slice(hash + 1));
  } catch {
    return null;
  }
  if (/[\\\x00-\x1f:?]/.test(relative) || relative.startsWith("/")) return null;
  const current = route.documentPath ?? (library === "docs" ? "README.md" : "");
  const parts = relative ? current.split("/").slice(0, -1) : [];
  if (relative) {
    for (const part of relative.split("/")) {
      if (part === "..") {
        if (!parts.length) return null;
        parts.pop();
      } else if (part && part !== ".") parts.push(part);
    }
  }
  const target = relative ? parts.join("/") : current;
  const valid =
    library === "docs"
      ? target === "README.md" || target === "AGENTS.md" || /^docs\/.+\.md$/i.test(target)
      : /^.+\.md$/i.test(target);
  if (!valid) return null;
  return formatRoute({ ...route, view: library, documentPath: target, section });
}
