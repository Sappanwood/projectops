import type { DocumentList, ProjectDocument } from "../docs/documentReader.js";
import type { AppError, RouteState } from "./types.js";
import { renderReadingBody } from "./markdown.js";
import { escapeHtml as e } from "./render.js";
import { formatRoute } from "./router.js";

export type DocsState = { list: DocumentList | null; document: ProjectDocument | null; loading: boolean; error: AppError | null; listError: AppError | null };
export const emptyDocsState = (): DocsState => ({list:null, document:null, loading:false, error:null, listError:null});

export function documentLink(url: string, route: RouteState): string | null {
  if (/^[a-z][a-z\d+.-]*:|^\/|[\\\x00-\x1f]/i.test(url)) return null;
  const hash = url.indexOf("#");
  const rawPath = hash < 0 ? url : url.slice(0, hash);
  let section: string | undefined;
  let relative: string;
  try { relative = decodeURIComponent(rawPath); section = hash < 0 ? undefined : decodeURIComponent(url.slice(hash + 1)); } catch { return null; }
  if (/[\\\x00-\x1f:?]/.test(relative) || relative.startsWith("/")) return null;
  const current = route.documentPath ?? "README.md";
  const parts = relative ? current.split("/").slice(0,-1) : [];
  if (relative) {
    for (const part of relative.split("/")) {
      if (part === "..") { if (!parts.length) return null; parts.pop(); }
      else if (part && part !== ".") parts.push(part);
    }
  }
  const target = relative ? parts.join("/") : current;
  if (!(target === "README.md" || target === "AGENTS.md" || /^docs\/.+\.md$/i.test(target))) return null;
  return formatRoute({...route, view:"docs", documentPath:target, section});
}

export function renderDocs(state: DocsState, route: RouteState): string {
  const selected = route.documentPath ?? "README.md";
  const headings: Array<{title:string; id:string; level:number}> = [];
  const counts = new Map<string,number>();
  const reader = state.document ? renderReadingBody(state.document.body, `doc-${selected}`, {
    headingId(title, level) {
      const base = title.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s/g, "-") || "section";
      const count = counts.get(base) ?? 0; counts.set(base,count + 1);
      const id = `${base}${count ? `-${count}` : ""}`;
      headings.push({title, id, level}); return `doc-heading-${id}`;
    },
    resolveLink: url => documentLink(url, route),
  }) : "";
  return `<h2>Project Docs</h2><div class="docs-layout">
    <nav class="docs-nav" aria-label="项目文档"><h3>文档</h3>${state.listError ? `<p role="alert">${e(state.listError.message)}</p>` : ""}
    <ul>${(state.list?.documents ?? []).map(doc => `<li><a href="${e(formatRoute({...route, view:"docs", documentPath:doc.path, section:undefined}))}" ${doc.path === selected ? 'aria-current="page"' : ""}>${e(doc.path)}</a><small>${e(doc.standard ? (doc.issue ?? "标准文档 · 检查通过") : (doc.issue ?? "扩展文档 · 未参与标准检查"))}</small></li>`).join("")}</ul>
    ${(state.list?.diagnostics ?? []).map(d => `<p class="reading-notice">${e(d.path)}：${e(d.issue)}</p>`).join("")}</nav>
    <article class="document-content" aria-label="文档正文"><p class="document-path"><code>${e(selected)}</code></p>
    ${state.document && route.section && !headings.some(h => h.id === route.section) ? `<p class="reading-notice" role="status">未找到章节：${e(route.section)}</p>` : ""}
    ${state.loading ? '<p role="status">正在读取文档…</p>' : state.error ? `<p role="alert">${e(state.error.message)}</p><button id="docs-retry" class="btn btn-secondary">重试读取</button>` : reader}
    </article>
    <nav class="document-toc" aria-label="章节目录"><h3>章节目录</h3>${headings.length ? `<ul>${headings.map(h => `<li class="toc-level-${h.level}"><a href="${e(formatRoute({...route,view:"docs",documentPath:selected,section:h.id}))}">${e(h.title)}</a></li>`).join("")}</ul>` : '<p class="muted">暂无章节</p>'}</nav>
  </div>`;
}
