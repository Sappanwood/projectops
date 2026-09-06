import type { DocumentList, ProjectDocument } from "../docs/documentReader.js";
import type { AppError, RouteState } from "./types.js";
import { renderReadingBody } from "./markdown.js";
import { escapeHtml as e } from "./render.js";
import { formatRoute } from "./router.js";

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

export function renderDocs(state: DocsState, route: RouteState): string {
  return renderDocumentLibrary(state, route, "docs");
}

export function renderResearch(state: DocsState, route: RouteState): string {
  return renderDocumentLibrary(state, route, "research");
}

function renderDocumentLibrary(
  state: DocsState,
  route: RouteState,
  library: DocumentLibrary,
): string {
  const selected =
    library === "docs" ? (route.documentPath ?? "README.md") : (route.documentPath ?? "");
  const headings: Array<{ title: string; id: string; level: number }> = [];
  const counts = new Map<string, number>();
  const reader = state.document
    ? renderReadingBody(state.document.body, `${library}-${selected}`, {
        headingId(title, level) {
          const base =
            title
              .toLowerCase()
              .replace(/[^\p{L}\p{N}\s_-]/gu, "")
              .trim()
              .replace(/\s/g, "-") || "section";
          const count = counts.get(base) ?? 0;
          counts.set(base, count + 1);
          const id = `${base}${count ? `-${count}` : ""}`;
          headings.push({ title, id, level });
          return `${library === "docs" ? "doc" : "research"}-heading-${id}`;
        },
        resolveLink: (url) => documentLink(url, route, library),
      })
    : "";
  const title = library === "docs" ? "Project Docs" : "Research";
  const navLabel = library === "docs" ? "项目文档" : "项目 Research";
  const emptyMessage = library === "docs" ? "暂无文档。" : "暂无 Research 文档。";
  const documentMessage =
    library === "docs" ? "选择一篇文档阅读。" : "选择一篇 Research 文档阅读。";
  const documentList =
    state.list === null
      ? state.loading
        ? '<li class="muted" role="status">正在读取文档列表…</li>'
        : state.listError
          ? ""
          : `<li class="muted">${emptyMessage}</li>`
      : state.list.documents.length === 0
        ? `<li class="muted">${emptyMessage}</li>`
        : state.list.documents
            .map(
              (doc) =>
                `<li><a href="${e(formatRoute({ ...route, view: library, documentPath: doc.path, section: undefined }))}" ${doc.path === selected ? 'aria-current="page"' : ""}>${e(doc.path)}</a><small>${e(library === "research" ? "Research 文档" : doc.standard ? (doc.issue ?? "标准文档 · 检查通过") : (doc.issue ?? "扩展文档 · 未参与标准检查"))}</small></li>`,
            )
            .join("");
  return `<h2>${title}</h2><div class="docs-layout">
    <nav class="docs-nav" aria-label="${navLabel}"><h3>文档</h3>${state.listError ? `<p role="alert">${e(state.listError.message)}</p>` : ""}
    <ul>${documentList}</ul>
    ${(state.list?.diagnostics ?? []).map((d) => `<p class="reading-notice">${e(d.path)}：${e(d.issue)}</p>`).join("")}</nav>
    <article class="document-content" aria-label="${library === "docs" ? "文档正文" : "Research 正文"}"><p class="document-path"><code>${e(selected || "Research")}</code></p>
    ${state.document && route.section && !headings.some((h) => h.id === route.section) ? `<p class="reading-notice" role="status">未找到章节：${e(route.section)}</p>` : ""}
    ${state.loading ? '<p role="status">正在读取文档…</p>' : state.error ? `<p role="alert">${e(state.error.message)}</p><button id="${library}-retry" class="btn btn-secondary">重试读取</button>` : reader || `<div class="reading-empty"><p>${documentMessage}</p></div>`}
    </article>
    <nav class="document-toc" aria-label="章节目录"><h3>章节目录</h3>${headings.length ? `<ul>${headings.map((h) => `<li class="toc-level-${h.level}"><a href="${e(formatRoute({ ...route, view: library, documentPath: selected, section: h.id }))}">${e(h.title)}</a></li>`).join("")}</ul>` : '<p class="muted">暂无章节</p>'}</nav>
  </div>`;
}
