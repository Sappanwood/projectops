import type { WorkbenchPlan } from "../application/planExecution.js";
import { mappingTarget } from "./planIdentityView.js";
import { formatRoute } from "./router.js";

function taskLink(owner: string, planId: string, id: string, title: string, projectId = owner) {
  return (
    <a
      href={formatRoute({
        projectId,
        view: "backlog",
        itemId: id,
        ...(projectId === owner ? { planId } : {}),
        returnTo: formatRoute({ projectId: owner, view: "plans", planId, planTab: "execution" }),
      })}
    >
      {projectId}:{id} — {title}
    </a>
  );
}

export function PlanExecutionView({ plan, projectId }: { plan: WorkbenchPlan; projectId: string }) {
  const { execution, next_tasks: next, materialization: mapping, delivery_reports: reports } = plan;
  const { counts } = execution;
  const labels = {
    todo: "待开始",
    in_progress: "进行中",
    done: "已完成",
    blocked: "受阻",
    cancelled: "已取消",
    unreadable: "无法读取",
  };
  const completed = execution.materialized && counts.total > 0 && counts.done === counts.total;
  return (
    <div className="plan-execution-document">
      <section className="plan-execution" id={`${plan.id}--section-progress`} aria-label="执行进度">
        <p className="plan-eyebrow">PROGRESS</p>
        <h2>执行进度</h2>
        {!execution.materialized && !mapping ? (
          <p>未开始执行 · 尚未生成 Backlog 条目。</p>
        ) : (
          <>
            {counts.total === 0 ? (
              <p>无可执行任务</p>
            ) : (
              <>
                <div className="execution-heading">
                  <strong>
                    {counts.done}/{counts.total} 已完成
                  </strong>
                  <span>
                    {execution.completion_percent === null
                      ? "物化未完成"
                      : `${execution.completion_percent}%`}
                  </span>
                </div>
                <progress aria-label="任务完成进度" value={counts.done} max={counts.total} />
                <p className="execution-counts">
                  待开始 {counts.todo} · 进行中 {counts.in_progress} · 已完成 {counts.done} ·
                  无法读取 {counts.unreadable}
                  {counts.blocked ? ` · 受阻 ${counts.blocked}` : ""}
                  {counts.cancelled ? ` · 已取消 ${counts.cancelled}` : ""}
                </p>
              </>
            )}
            <ul className="execution-items">
              {execution.items.map((item) => (
                <li key={item.key}>
                  <span>
                    {mapping && !mapping.mapping[item.key]
                      ? `${item.project ?? projectId} · ${item.title}（尚未创建）`
                      : taskLink(projectId, plan.id, item.id, item.title, item.project)}
                    {item.item_type === "epic" && <small> Epic · 不计入完成率</small>}
                  </span>
                  <span className={`badge badge-${item.status}`}>{labels[item.status]}</span>
                  {item.diagnostic && <p className="error-message">{item.diagnostic.message}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="plan-delivery" aria-label="交付报告">
        <p className="plan-eyebrow">DELIVERY</p>
        <h2>交付报告</h2>
        {reports.length ? (
          <>
            <p className="muted">报告记录创建时的交付快照，当前任务进度以执行进度为准。</p>
            <ul>
              {reports.map((report) => (
                <li key={report.id}>
                  <a
                    href={formatRoute({
                      projectId,
                      view: "reports",
                      reportId: report.id,
                      planId: plan.id,
                      returnTo: formatRoute({
                        projectId,
                        view: "plans",
                        planId: plan.id,
                        planTab: "execution",
                      }),
                    })}
                  >
                    {report.id} — {report.title}
                  </a>
                  <span className="badge">{report.outcome}</span>
                  <time dateTime={report.created_at}>{report.created_at}</time>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>{completed ? "任务已完成，尚无交付报告。" : "尚无交付报告。"}</p>
        )}
      </section>
      <section className="plan-workspace" id={`${plan.id}--section-work`} aria-label="执行工作区">
        <header>
          <h2>执行工作区</h2>
          <p className="form-help">
            选择运行方式，查看当前执行与需要处理的任务。串行与并行记录分别保留。
          </p>
        </header>
        <div data-plan-run-host />
      </section>
      <section className="plan-next">
        <h2>下一步任务</h2>
        <div className="plan-next-groups">
          {(
            [
              ["进行中任务", next.in_progress],
              ["可开始任务", next.ready],
              ["受阻任务", next.blocked],
            ] as const
          ).map(([label, items]) => (
            <section aria-label={label} key={label}>
              <h3>
                {label} ({items.length})
              </h3>
              {items.length ? (
                <ul>
                  {items.map((item) => (
                    <li key={`${item.project}/${item.id}`}>
                      {taskLink(projectId, plan.id, item.id, item.title, item.project)}{" "}
                      <span className="badge badge-priority">{item.priority}</span>
                      {"reasons" in item && (
                        <ul className="dependency-reasons">
                          {item.reasons.map((reason, index) => (
                            <li key={`${reason.id}/${index}`}>
                              依赖 {reason.id}：{reason.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">暂无任务</p>
              )}
            </section>
          ))}
        </div>
        {next.diagnostics.map((d, i) => (
          <p className="reading-notice" key={i}>
            {d.id}：{d.message}
          </p>
        ))}
      </section>
      <div data-plan-completion={plan.id} />
      <details className="technical-details plan-records" data-reading-key={`mapping-${plan.id}`}>
        <summary>计划记录与技术信息</summary>
        <dl>
          <dt>Plan ID</dt>
          <dd>{plan.id}</dd>
          <dt>Status</dt>
          <dd>{plan.status}</dd>
          {mapping && (
            <>
              <dt>Materialized at</dt>
              <dd>{mapping.materialized_at}</dd>
            </>
          )}
        </dl>
        {mapping ? (
          <>
            <h4>Materialization mapping</h4>
            <dl>
              {Object.entries(mapping.mapping).map(([key, value]) => {
                const target = mappingTarget(projectId, value);
                return (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>
                      {taskLink(
                        projectId,
                        plan.id,
                        target.id,
                        plan.items.find((item) => item.key === key)?.title ?? key,
                        target.project,
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </>
        ) : (
          <p className="muted">尚未生成 Backlog 条目。</p>
        )}
      </details>
    </div>
  );
}
