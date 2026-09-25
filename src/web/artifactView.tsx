import type { WorkbenchReadPages } from "../application/workbenchReadModel.js";
import type { Report } from "../report/report.js";
import type { RetrospectiveRecord } from "../retrospective/retrospective.js";
import { documentLink } from "./docsView.js";
import { renderReadingBody } from "./markdown.js";
import { RenderedHtml } from "./readingView.js";
import type { RetrospectiveFilters } from "./readPagesView.js";
import { formatRoute } from "./router.js";
import type { RouteState } from "./types.js";

function referenceLink(
  reference: string,
  origin: RouteState,
  targetProject = origin.projectId,
): string | null {
  const from = formatRoute({ ...origin, returnTo: undefined });
  const plan = /^project-ops:plans\/(plan-[a-z0-9-]+)\.json$/.exec(reference);
  const item = /^project-ops:backlog\/items\/([A-Z]+-\d+)\.md$/.exec(reference);
  if (plan)
    return formatRoute({
      projectId: targetProject,
      view: "plans",
      planId: plan[1]!,
      returnTo: from,
    });
  if (item)
    return formatRoute({
      projectId: targetProject,
      view: "backlog",
      itemId: item[1]!,
      returnTo: from,
    });
  return documentLink(reference, {
    projectId: targetProject,
    view: "docs",
    documentPath: "README.md",
    returnTo: from,
  });
}

function Reference({
  reference,
  label,
  origin,
  project = origin.projectId,
}: {
  reference: string;
  label: string;
  origin: RouteState;
  project?: string | null;
}) {
  const href = referenceLink(reference, origin, project);
  return href ? <a href={href}>{label}</a> : <span title="无法在工作台打开此引用">{label}</span>;
}

function Fields({ entries }: { entries: Array<[string, string | null | undefined]> }) {
  return (
    <dl>
      {entries.map(([label, value]) => (
        <div className="record-field" key={label}>
          <dt>{label}</dt>
          <dd>{value ?? "Not recorded"}</dd>
        </div>
      ))}
    </dl>
  );
}
function Strings({ title, values }: { title: string; values: string[] }) {
  return (
    <>
      <h4>{title}</h4>
      {values.length ? (
        <ul>
          {values.map((value, index) => (
            <li key={index}>{value}</li>
          ))}
        </ul>
      ) : (
        <p>None recorded.</p>
      )}
    </>
  );
}

export function ReportsPage({ reports, route }: { reports: Report[]; route: RouteState }) {
  return (
    <div className="domain-page artifact-library">
      <header className="domain-page-header">
        <div>
          <p className="plan-eyebrow">PROJECT WORKSPACE / REPORTS</p>
          <h1>
            Delivery Reports <span className="group-count">({reports.length})</span>
          </h1>
          <p className="muted">查看交付结果、验证证据和需要保留的说明。</p>
        </div>
      </header>
      {route.planId && !route.returnTo && (
        <p>
          <a
            className="btn btn-secondary"
            href={formatRoute({ projectId: route.projectId, view: "plans", planId: route.planId })}
          >
            返回原 Plan
          </a>
        </p>
      )}
      {route.reportId && !reports.some((report) => report.id === route.reportId) && (
        <p role="alert">Report 不存在或无法读取。</p>
      )}
      {reports.map((report) => (
        <ReportDocument key={report.id} report={report} route={route} />
      ))}
      {!reports.length && <p className="empty-list-text">No delivery reports found.</p>}
    </div>
  );
}

function ReportDocument({ report, route }: { report: Report; route: RouteState }) {
  const origin = { ...route, view: "reports" as const, reportId: report.id };
  return (
    <details className="artifact-detail" data-report-id={report.id} data-reading-key={report.id}>
      <summary>
        <span className="artifact-title">{report.title}</span>{" "}
        <span className={`badge badge-${report.outcome}`}>{report.outcome}</span>
        <small>
          {report.created_at} · {report.id}
        </small>
        <a className="artifact-open" href={formatRoute(origin)}>
          打开报告
        </a>
      </summary>
      <p className="reading-notice">报告记录创建时的交付快照，当前任务进度以 Backlog 为准。</p>
      <p>
        关联计划：
        <Reference
          reference={report.plan}
          label={report.plan.replace("project-ops:plans/", "").replace(/\.json$/, "")}
          origin={origin}
        />
      </p>
      <RenderedHtml
        html={renderReadingBody(report.body, `report-body-${report.id}`, {
          resolveLink: (url) => referenceLink(url, origin),
        })}
      />
      <section className="evidence-section">
        <Strings title="Verification · 验证证据" values={report.verification} />
        <Strings title="Deviations · 偏离" values={report.deviations} />
        <Strings title="Workarounds · 处理方式" values={report.workarounds} />
      </section>
      <h4>Backlog references</h4>
      {report.backlog.length ? (
        <ul>
          {report.backlog.map((item) => (
            <li key={`${item.project}/${item.id}`}>
              <Reference
                reference={`project-ops:backlog/items/${item.id}.md`}
                label={`${item.project ?? report.project}:${item.id}`}
                origin={origin}
                project={item.project ?? report.project}
              />{" "}
              <span className={`badge badge-${item.status}`}>{item.status}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-list-text">No backlog results found.</p>
      )}
      <h4>Repo docs</h4>
      <ul>
        {report.repo_docs.map((doc) => (
          <li key={doc}>
            <Reference reference={doc} label={doc} origin={origin} />
          </li>
        ))}
      </ul>
      <details className="technical-details" data-reading-key={`report-records-${report.id}`}>
        <summary>报告记录与技术信息</summary>
        <Fields
          entries={[
            ["Outcome", report.outcome],
            ["Project", report.project],
            ["Created at", report.created_at],
            ["Plan reference", report.plan],
          ]}
        />
        {report.backlog.map((item) => (
          <Fields
            key={`${item.project}/${item.id}`}
            entries={[
              [item.id, item.uri],
              ["Revision", item.revision],
            ]}
          />
        ))}
      </details>
    </details>
  );
}

export function RetrospectivesPage({
  records,
  route,
  filters,
}: {
  records: WorkbenchReadPages["retrospectives"];
  route: RouteState;
  filters: RetrospectiveFilters;
}) {
  const filtered = records.filter(
    (record) =>
      (filters.project === "" ||
        (filters.project === "null"
          ? record.project === null
          : record.project === filters.project)) &&
      (filters.task === "" ||
        (filters.task === "null" ? record.task === null : record.task === filters.task)) &&
      (filters.status === "" || record.status === filters.status),
  );
  const selected = route.retrospectiveId
    ? records.find((record) => record.id === route.retrospectiveId)
    : undefined;
  const names: Record<string, string> = { inbox: "待审阅", active: "待处理", archive: "已归档" };
  return (
    <div className="domain-page artifact-library">
      <header className="domain-page-header">
        <div>
          <p className="plan-eyebrow">WORKSPACE / RETROSPECTIVES</p>
          <h1>
            Workflow Retrospectives <span className="group-count">({filtered.length})</span>
          </h1>
          <p className="muted">确认工作中的问题，查看后续行动与处理结果。</p>
        </div>
      </header>
      <form
        id="retrospective-filters"
        className="read-filters"
        key={`${filters.project}/${filters.status}/${filters.task}`}
      >
        <label htmlFor="retro-status">Status</label>
        <select
          id="retro-status"
          name="status"
          className="form-select"
          defaultValue={filters.status}
        >
          {["", "inbox", "active", "archive"].map((status) => (
            <option key={status} value={status}>
              {status || "All statuses"}
            </option>
          ))}
        </select>
        <label htmlFor="retro-project">Project</label>
        <input
          id="retro-project"
          name="project"
          defaultValue={filters.project}
          placeholder="All projects"
          className="form-input"
        />
        <label htmlFor="retro-task">Task</label>
        <input
          id="retro-task"
          name="task"
          defaultValue={filters.task}
          placeholder="All tasks"
          className="form-input"
        />
        <button type="submit" className="btn btn-secondary">
          Apply filters
        </button>
        <p>Exact project/task match; leave blank for all, use null for unrecorded provenance.</p>
      </form>
      {route.retrospectiveId && !selected && <p role="alert">回顾不存在或无法读取。</p>}
      {selected && !filtered.includes(selected) && (
        <>
          <p className="reading-notice">当前回顾不符合筛选条件，仍显示直达记录。</p>
          <RetrospectiveDocument record={selected} route={route} filters={filters} />
        </>
      )}
      {["inbox", "active", "archive"].map((status) => {
        const group = filtered.filter((record) => record.status === status);
        return (
          <section key={status} className="artifact-group" aria-label={status}>
            <h2>
              {names[status]}{" "}
              <span className="group-count">
                {status} ({group.length})
              </span>
            </h2>
            {group.length ? (
              group.map((record) => (
                <RetrospectiveDocument
                  key={record.id}
                  record={record}
                  route={route}
                  filters={filters}
                />
              ))
            ) : (
              <p className="empty-list-text">No {status} retrospectives found.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function RetrospectiveDocument({
  record,
  route,
  filters,
}: {
  record: RetrospectiveRecord;
  route: RouteState;
  filters: RetrospectiveFilters;
}) {
  const origin = {
    ...route,
    view: "retrospectives" as const,
    retrospectiveId: record.id,
    retrospectiveFilters: filters,
  };
  const excerpt =
    record.body
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !/^#/.test(line)) ?? record.id;
  return (
    <details
      className="artifact-detail"
      data-retrospective-id={record.id}
      data-reading-key={`retro-${record.id}`}
    >
      <summary>
        <span className="artifact-title">{excerpt.slice(0, 120)}</span>{" "}
        <span className={`badge badge-${record.status}`}>{record.status}</span>
        <small>
          {record.created_at} · {record.project ?? "No project"} · {record.id}
        </small>
        <a className="artifact-open" href={formatRoute(origin)}>
          打开回顾
        </a>
      </summary>
      <RenderedHtml html={renderReadingBody(record.body, `retro-body-${record.id}`)} />
      {record.project && record.task && (
        <p>
          关联任务：
          <a
            href={formatRoute({
              projectId: record.project,
              view: "backlog",
              itemId: record.task,
              returnTo: formatRoute({ ...origin, returnTo: undefined }),
            })}
          >
            {record.task}
          </a>
        </p>
      )}
      {record.next_action && (
        <section className="evidence-section">
          <h4>下一步行动</h4>
          <RenderedHtml html={renderReadingBody(record.next_action, `retro-next-${record.id}`)} />
        </section>
      )}
      {record.resolution_note && (
        <section className="evidence-section">
          <h4>结案说明</h4>
          <RenderedHtml
            html={renderReadingBody(record.resolution_note, `retro-resolution-${record.id}`)}
          />
        </section>
      )}
      <h4>Backlog links</h4>
      <ul>
        {(record.backlog ?? []).map((ref) => (
          <li key={ref}>
            {record.project ? (
              <Reference reference={ref} label={ref} origin={origin} project={record.project} />
            ) : (
              ref
            )}
          </li>
        ))}
      </ul>
      <details className="technical-details" data-reading-key={`retro-records-${record.id}`}>
        <summary>回顾记录与技术信息</summary>
        <Fields
          entries={[
            ["Status", record.status],
            ["Project", record.project],
            ["Task", record.task],
            ["Created at", record.created_at],
            ["Trigger", record.trigger],
            ["Harness", record.harness],
            ["Model", record.model],
            ["Path", record.path],
            ["Revision", record.revision],
            ["Disposition", record.disposition],
            ["Owner scope", record.owner_scope],
            ["Action disposition", record.action_disposition],
            ["Actioned at", record.actioned_at],
            ["Canonical", record.canonical],
          ]}
        />
        <Strings title="Categories" values={record.categories ?? []} />
        <Strings title="Related info" values={record.related_info ?? []} />
      </details>
    </details>
  );
}
