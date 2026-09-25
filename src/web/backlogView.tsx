import type { BacklogViewState } from "./backlogController.js";
import { renderReadingBody } from "./markdown.js";
import { RenderedHtml } from "./readingView.js";

const labels: Record<string, string> = {
  todo: "待办",
  in_progress: "进行中",
  blocked: "受阻",
  done: "已完成",
  cancelled: "已取消",
};

export function BacklogPage({ state }: { state: BacklogViewState }) {
  if (state.loading) return <p role="status">Loading backlog…</p>;
  if (state.error)
    return (
      <>
        <p role="alert">{state.error.message}</p>
        <button className="btn btn-secondary" id="backlog-refresh">
          Retry backlog
        </button>
      </>
    );
  const item = state.item;
  return (
    <div className="domain-page">
      <header className="domain-page-header">
        <div>
          <p className="plan-eyebrow">PROJECT WORKSPACE / BACKLOG</p>
          <h1>
            Backlog <span className="group-count">{state.items.length}</span>
          </h1>
          <p className="muted">选择任务，阅读要求并推进状态。</p>
        </div>
        <button
          className="btn btn-secondary"
          id="backlog-refresh"
          aria-label="Refresh backlog"
          disabled={state.saving}
        >
          刷新列表
        </button>
      </header>
      <div className="backlog-layout">
        <aside className="backlog-sidebar" aria-label="任务列表">
          {Object.entries(labels).map(([status, label]) => {
            const items = state.items
              .filter((item) => item.status === status)
              .toSorted((a, b) => a.id.localeCompare(b.id));
            if (!items.length) return null;
            const heading = (
              <>
                {label} <span className="group-count">{items.length}</span>
              </>
            );
            const list = (
              <ul className="items-list">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      className="backlog-select"
                      data-backlog-item={item.id}
                      disabled={state.saving}
                      aria-label={`${item.id} — ${item.title} (${item.priority})`}
                      aria-pressed={item.id === state.selectedItemId}
                    >
                      <span className="backlog-select-title">{item.title}</span>
                      <span className="item-meta">
                        <code>{item.id}</code>
                        <span className="badge badge-priority">{item.priority}</span>
                        <span className={`badge badge-${status}`}>{label}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            );
            return status === "done" ? (
              <details
                key={status}
                className="backlog-group"
                data-reading-key="backlog-group-done"
                open={items.some((item) => item.id === state.selectedItemId)}
              >
                <summary>{heading}</summary>
                {list}
              </details>
            ) : (
              <section className="backlog-group" key={status}>
                <h3>{heading}</h3>
                {list}
              </section>
            );
          })}
          {!state.items.length && <p>No backlog items found.</p>}
        </aside>
        <section
          className="reading-panel"
          aria-label="Backlog item detail"
          key={`${state.projectId}/${state.selectedItemId}`}
        >
          {state.detailLoading && <p role="status">Loading item…</p>}
          {state.detailError && (
            <p className="reading-notice" role="alert">
              {state.detailError.code ?? "ERROR"}: {state.detailError.message}
            </p>
          )}
          {item && !state.detailLoading ? (
            <>
              <header className="reading-header">
                <div className="item-meta">
                  <code>{item.id}</code>
                  <span className="badge badge-priority">{item.priority}</span>
                  <span
                    className={`badge badge-${item.status}`}
                    aria-label={`Status: ${item.status}`}
                  >
                    {labels[item.status] ?? item.status}
                  </span>
                </div>
                <h2>{item.title}</h2>
                <div className="reading-actions">
                  <div className="status-actions" aria-label="Update item status">
                    <span className="muted">状态</span>
                    {["todo", "in_progress", "done"].map((status) => (
                      <button
                        key={status}
                        className={`btn ${item.status === status ? "btn-primary" : "btn-secondary"}`}
                        aria-label={status}
                        aria-pressed={item.status === status}
                        data-backlog-status={status}
                        disabled={state.saving || state.detailError?.code === "REVISION_MISMATCH"}
                      >
                        {labels[status]}
                      </button>
                    ))}
                  </div>
                  <button
                    className="btn btn-secondary"
                    id="backlog-item-refresh"
                    aria-label="Refresh item"
                    disabled={state.saving}
                  >
                    刷新条目
                  </button>
                </div>
                {!!item.depends_on.length && (
                  <p className="dependency-line">依赖：{item.depends_on.join(", ")}</p>
                )}
              </header>
              <RenderedHtml html={renderReadingBody(item.body, `backlog-${item.id}`)} />
              <section data-dependency-panel="" />
              <details className="technical-details" data-reading-key={`backlog-meta-${item.id}`}>
                <summary>技术信息</summary>
                <dl>
                  <dt>Revision</dt>
                  <dd>
                    <code>{item.revision}</code>
                  </dd>
                  <dt>Status</dt>
                  <dd>Status: {item.status}</dd>
                  <dt>Dependencies</dt>
                  <dd>{item.depends_on.join(", ") || "None"}</dd>
                </dl>
              </details>
              <section data-foundation-editor="" />
              <section data-execution-panel="" aria-label="任务执行" />
            </>
          ) : state.selectedItemId !== null ? (
            <button className="btn btn-secondary" id="backlog-item-refresh" disabled={state.saving}>
              Refresh item
            </button>
          ) : (
            <div className="reading-empty">
              <h3>选择一个任务</h3>
              <p>从左侧列表查看目标、验收标准和任务详情。</p>
            </div>
          )}
          {state.saving && <p role="status">Saving…</p>}
          {state.message && (
            <p className="reading-notice" role="status">
              {state.message}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
