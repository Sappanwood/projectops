import type { ReactNode } from "react";
import { formatRoute } from "./router.js";
import type {
  AppState,
  RouteState,
  ViewType,
  WorkbenchDiagnostic,
  WorkbenchProjectOverview,
} from "./types.js";

export function WorkspaceLanding({ state }: { state: AppState }) {
  return (
    <div className="workspace-landing">
      <header className="domain-page-header">
        <div>
          <p className="plan-eyebrow">WORKSPACE / PROJECTS</p>
          <h1>Workspace Projects</h1>
          <p className="muted">选择项目，审阅提案、跟进任务并确认交付。</p>
        </div>
      </header>
      <div className="project-grid">
        {state.workspace?.projects.map((project) => (
          <a
            key={project.id}
            href={formatRoute({ projectId: project.id, view: "overview" })}
            className="project-card"
            data-project-id={project.id}
          >
            <div className="project-card-header">
              <h3 className="project-card-title">{project.id}</h3>
              <span className="project-card-arrow" aria-hidden="true">
                →
              </span>
            </div>
            <p className="project-card-path">
              Path: <code>{project.path}</code>
            </p>
          </a>
        ))}
      </div>
    </div>
  );
}

function overviewLink(projectId: string, view: ViewType, id?: string): string {
  const route: RouteState = {
    projectId,
    view,
    returnTo: formatRoute({ projectId, view: "overview" }),
  };
  if (view === "plans" && id) route.planId = id;
  if (view === "backlog" && id) route.itemId = id;
  if (view === "reports" && id) route.reportId = id;
  if (view === "retrospectives") {
    if (id) route.retrospectiveId = id;
    route.retrospectiveFilters = { project: projectId, status: "", task: "" };
  }
  return formatRoute(route);
}

function Preview({
  overview,
  source,
  shown,
  total,
}: {
  overview: WorkbenchProjectOverview;
  source: WorkbenchDiagnostic["source"];
  shown: number;
  total: number;
}) {
  const problems = overview.diagnostics.filter((d) => d.source === source);
  return (
    <>
      <p className="overview-preview muted">
        展示 {shown} / {problems.length ? "已读取" : "共"} {total} 条
      </p>
      {!!problems.length && (
        <p className="reading-notice" role="status">
          部分数据无法读取，数量仅代表已读取记录。{problems.map((d) => d.message).join(" ")}
        </p>
      )}
    </>
  );
}
function Row({
  title,
  id,
  metadata,
  href,
}: {
  title: string;
  id: string;
  metadata: ReactNode;
  href: string;
}) {
  return (
    <li className="item-row">
      <a className="item-title" href={href}>
        {title}
      </a>
      <div className="overview-item-meta">{metadata}</div>
      <span className="item-id">
        <code>{id}</code>
      </span>
    </li>
  );
}
function RecordedDate({ value }: { value: string }) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? (
    value
  ) : (
    <time dateTime={value} title={value}>
      {date.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })}
    </time>
  );
}
function Progress({
  execution,
}: {
  execution: WorkbenchProjectOverview["plans"][number]["execution"];
}) {
  const progress = !execution.materialized
    ? "未开始执行"
    : execution.counts.total === 0
      ? "无可执行任务"
      : `任务完成 ${execution.counts.done} / ${execution.counts.total} · ${execution.completion_percent}%`;
  return (
    <>
      <span className="overview-progress">{progress}</span>
      {execution.diagnostics.map((d, i) => (
        <span className="reading-notice" key={i}>
          {d.message}
        </span>
      ))}
    </>
  );
}

export function OverviewPage({ overview }: { overview: WorkbenchProjectOverview }) {
  const projectId = overview.project.id;
  const bCounts = overview.backlog.counts;
  const rCounts = overview.retrospectives.counts;
  const backlogTotal =
    overview.backlog.mode === "active"
      ? bCounts.todo + bCounts.in_progress
      : Object.values(bCounts).reduce((sum, count) => sum + count, 0);
  const failed = (source: WorkbenchDiagnostic["source"]) =>
    overview.diagnostics.some((d) => d.source === source);
  return (
    <>
      <header className="domain-page-header">
        <div>
          <p className="plan-eyebrow">PROJECT WORKSPACE / OVERVIEW</p>
          <h1>{projectId}</h1>
          <p className="muted">从待审阅方案到已交付成果，查看项目当前进展。</p>
        </div>
      </header>
      <div className="overview-grid">
        <section className="overview-card" aria-labelledby="card-plans-title">
          <div className="card-header">
            <h3 id="card-plans-title">Plans ({overview.plans.length})</h3>
          </div>
          <Preview
            overview={overview}
            source="plans"
            shown={Math.min(5, overview.plans.length)}
            total={overview.plans.length}
          />
          <div className="card-body">
            {overview.plans.length ? (
              <ul className="items-list">
                {overview.plans.slice(0, 5).map((plan) => (
                  <Row
                    key={plan.id}
                    title={plan.title}
                    id={plan.id}
                    href={overviewLink(projectId, "plans", plan.id)}
                    metadata={
                      <>
                        <span className={`badge badge-${plan.status}`}>{plan.status}</span>
                        <span>{plan.item_count} 个计划条目</span>
                        <Progress execution={plan.execution} />
                      </>
                    }
                  />
                ))}
              </ul>
            ) : (
              !failed("plans") && <p className="empty-list-text">暂无计划。</p>
            )}
          </div>
          <a href={overviewLink(projectId, "plans")} className="card-link">
            查看全部 Plans →
          </a>
        </section>
        <section className="overview-card" aria-labelledby="card-backlog-title">
          <div className="card-header">
            <h3 id="card-backlog-title">Backlog</h3>
          </div>
          <div className="counts-row">
            <span className="badge badge-todo">{bCounts.todo} todo</span>
            <span className="badge badge-inprogress">{bCounts.in_progress} in progress</span>
            <span className="badge badge-blocked">{bCounts.blocked} blocked</span>
            <span className="badge badge-done">{bCounts.done} done</span>
          </div>
          <Preview
            overview={overview}
            source="backlog"
            shown={overview.backlog.recent.length}
            total={backlogTotal}
          />
          <div className="card-body">
            <h4>{overview.backlog.mode === "active" ? "进行中与待办" : "最近更新"}</h4>
            {overview.backlog.mode === "recent" && !failed("backlog") && (
              <p className="muted">当前没有进行中或待办任务。</p>
            )}
            {overview.backlog.recent.length ? (
              <ul className="items-list">
                {overview.backlog.recent.map((item) => (
                  <Row
                    key={item.id}
                    title={item.title}
                    id={item.id}
                    href={overviewLink(projectId, "backlog", item.id)}
                    metadata={
                      <>
                        <span className={`badge badge-${item.status}`}>{item.status}</span>
                        <span>{item.priority}</span>
                      </>
                    }
                  />
                ))}
              </ul>
            ) : (
              !failed("backlog") && <p className="empty-list-text">暂无任务。</p>
            )}
          </div>
          <a href={overviewLink(projectId, "backlog")} className="card-link">
            查看全部 Backlog →
          </a>
        </section>
        <section className="overview-card" aria-labelledby="card-reports-title">
          <div className="card-header">
            <h3 id="card-reports-title">Reports ({overview.reports.length})</h3>
          </div>
          <Preview
            overview={overview}
            source="reports"
            shown={Math.min(5, overview.reports.length)}
            total={overview.reports.length}
          />
          <div className="card-body">
            {overview.reports.length ? (
              <ul className="items-list">
                {overview.reports.slice(0, 5).map((report) => (
                  <Row
                    key={report.id}
                    title={report.title}
                    id={report.id}
                    href={overviewLink(projectId, "reports", report.id)}
                    metadata={
                      <>
                        <span className={`badge badge-${report.outcome}`}>{report.outcome}</span>
                        <RecordedDate value={report.created_at} />
                      </>
                    }
                  />
                ))}
              </ul>
            ) : (
              !failed("reports") && <p className="empty-list-text">暂无交付报告。</p>
            )}
          </div>
          <a href={overviewLink(projectId, "reports")} className="card-link">
            查看全部 Reports →
          </a>
        </section>
        <section className="overview-card" aria-labelledby="card-retro-title">
          <div className="card-header">
            <h3 id="card-retro-title">Retrospectives</h3>
          </div>
          <div className="counts-row">
            <span className="badge badge-inbox">{rCounts.inbox} inbox</span>
            <span className="badge badge-active">{rCounts.active} active</span>
            <span className="badge badge-archive">{rCounts.archive} archive</span>
          </div>
          <Preview
            overview={overview}
            source="retrospectives"
            shown={overview.retrospectives.recent.length}
            total={Object.values(rCounts).reduce((sum, count) => sum + count, 0)}
          />
          <div className="card-body">
            {overview.retrospectives.recent.length ? (
              <ul className="items-list">
                {overview.retrospectives.recent.map((record) => (
                  <Row
                    key={record.id}
                    title={record.summary}
                    id={record.id}
                    href={overviewLink(projectId, "retrospectives", record.id)}
                    metadata={
                      <>
                        <span className={`badge badge-${record.status}`}>{record.status}</span>
                        <RecordedDate value={record.created_at} />
                      </>
                    }
                  />
                ))}
              </ul>
            ) : (
              !failed("retrospectives") && <p className="empty-list-text">当前项目暂无回顾。</p>
            )}
          </div>
          <a href={overviewLink(projectId, "retrospectives")} className="card-link">
            查看全部 Retrospectives →
          </a>
        </section>
        <section className="overview-card overview-docs" aria-labelledby="card-docs-title">
          <div className="card-header">
            <h3 id="card-docs-title">Project Docs</h3>
          </div>
          <div className="card-body">
            <span className={`badge ${overview.docs.healthy ? "badge-healthy" : "badge-problem"}`}>
              {overview.docs.healthy
                ? "✓ 标准文档检查通过"
                : overview.docs.problems.length
                  ? `⚠ ${overview.docs.problems.length} 个检查问题`
                  : "⚠ 检查不可用"}
            </span>
          </div>
          <p className="muted">
            检查范围：四份标准文档的文件类型与一级标题，不代表内容新鲜度或语义正确性。
          </p>
          <ul className="overview-document-list">
            {overview.docs.documents.map((document) => (
              <li key={document.path}>
                {document.readable ? (
                  <a
                    href={formatRoute({
                      projectId,
                      view: "docs",
                      documentPath: document.path,
                      returnTo: formatRoute({ projectId, view: "overview" }),
                    })}
                  >
                    {document.path}
                  </a>
                ) : (
                  <span>{document.path}</span>
                )}
                <small className={document.issue ? "document-issue" : "muted"}>
                  {document.issue ?? "可阅读"}
                </small>
              </li>
            ))}
          </ul>
          <a href={overviewLink(projectId, "docs")} className="card-link">
            查看全部 Docs →
          </a>
        </section>
      </div>
      <div data-dev-host="" />
    </>
  );
}
