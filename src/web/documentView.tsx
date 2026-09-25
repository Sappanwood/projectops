import { type DocsState, documentLink } from "./docsView.js";
import { renderReadingBody } from "./markdown.js";
import { RenderedHtml } from "./readingView.js";
import { formatRoute } from "./router.js";
import type { RouteState } from "./types.js";

export function DocumentLibrary({
  state,
  route,
  library,
}: {
  state: DocsState;
  route: RouteState;
  library: "docs" | "research";
}) {
  const selected = route.documentPath ?? (library === "docs" ? "README.md" : "");
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
  return (
    <div className="document-library">
      <header className="domain-page-header">
        <div>
          <p className="plan-eyebrow">PROJECT WORKSPACE / {library.toUpperCase()}</p>
          <h1>{library === "docs" ? "Project Docs" : "Research"}</h1>
          <p className="muted">
            {library === "docs"
              ? "阅读项目约定、产品设计与实现说明。"
              : "审阅调研依据、发现与建议。"}
          </p>
        </div>
      </header>
      <div className="docs-layout">
        <nav className="docs-nav" aria-label={library === "docs" ? "项目文档" : "项目 Research"}>
          <h3>文档</h3>
          {state.listError && <p role="alert">{state.listError.message}</p>}
          <ul>
            {state.list?.documents.length ? (
              state.list.documents.map((doc) => (
                <li key={doc.path}>
                  <a
                    href={formatRoute({
                      ...route,
                      view: library,
                      documentPath: doc.path,
                      section: undefined,
                    })}
                    aria-current={doc.path === selected ? "page" : undefined}
                  >
                    {doc.path}
                  </a>
                  <small>
                    {library === "research"
                      ? "Research 文档"
                      : doc.standard
                        ? (doc.issue ?? "标准文档 · 检查通过")
                        : (doc.issue ?? "扩展文档 · 未参与标准检查")}
                  </small>
                </li>
              ))
            ) : state.loading && !state.list ? (
              <li className="muted" role="status">
                正在读取文档列表…
              </li>
            ) : (
              !state.listError && (
                <li className="muted">
                  {library === "docs" ? "暂无文档。" : "暂无 Research 文档。"}
                </li>
              )
            )}
          </ul>
          {state.list?.diagnostics.map((d, index) => (
            <p className="reading-notice" key={`${d.path}/${index}`}>
              {d.path}：{d.issue}
            </p>
          ))}
        </nav>
        <article
          className="document-content"
          aria-label={library === "docs" ? "文档正文" : "Research 正文"}
          key={`${route.projectId}/${selected}`}
        >
          <p className="document-path">
            <code>{selected || "Research"}</code>
          </p>
          {state.document && route.section && !headings.some((h) => h.id === route.section) && (
            <p className="reading-notice" role="status">
              未找到章节：{route.section}
            </p>
          )}
          {state.loading ? (
            <p role="status">正在读取文档…</p>
          ) : state.error ? (
            <>
              <p role="alert">{state.error.message}</p>
              <button id={`${library}-retry`} className="btn btn-secondary">
                重试读取
              </button>
            </>
          ) : reader ? (
            <RenderedHtml html={reader} />
          ) : (
            <div className="reading-empty">
              <p>{library === "docs" ? "选择一篇文档阅读。" : "选择一篇 Research 文档阅读。"}</p>
            </div>
          )}
        </article>
        <nav className="document-toc" aria-label="章节目录">
          <h3>章节目录</h3>
          {headings.length ? (
            <ul>
              {headings.map((h) => (
                <li key={h.id} className={`toc-level-${h.level}`}>
                  <a
                    href={formatRoute({
                      ...route,
                      view: library,
                      documentPath: selected,
                      section: h.id,
                    })}
                  >
                    {h.title}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">暂无章节</p>
          )}
        </nav>
      </div>
    </div>
  );
}
