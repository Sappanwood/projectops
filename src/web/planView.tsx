import type { WorkbenchPlan } from "../application/planExecution.js";
import { renderReadingBody } from "./markdown.js";
import { renderPlanGraph } from "./planDependencyGraph.js";
import { PlanExecutionView } from "./planExecutionView.js";
import { formatRoute } from "./router.js";
import type { RouteState } from "./types.js";

export { RenderedHtml } from "./readingView.js";

import { RenderedHtml } from "./readingView.js";

const statuses = { draft: "待审阅", approved: "已批准", done: "已完成" };

export function PlansPage({ plans, route }: { plans: WorkbenchPlan[]; route: RouteState }) {
  if (route.planId) {
    const plan = plans.find((entry) => entry.id === route.planId);
    return (
      <>
        <a className="plan-back" href={formatRoute({ projectId: route.projectId, view: "plans" })}>
          <span aria-hidden="true">← </span>返回 Plans
        </a>
        {plan ? (
          <PlanDocument key={`${route.projectId}/${plan.id}`} plan={plan} route={route} />
        ) : (
          <section data-plan-id={route.planId}>
            <p role="alert">Plan 不存在或无法读取。</p>
            <div data-foundation-plan={route.planId} />
          </section>
        )}
      </>
    );
  }
  const active = plans.filter((plan) => plan.status !== "done");
  return (
    <div className="plan-library">
      <header className="plan-library-heading">
        <p className="plan-eyebrow">PROJECT WORKSPACE / PLANS</p>
        <h1>计划</h1>
        <p>从提案到交付，在这里审阅方案、跟进执行与确认结果。</p>
      </header>
      <div className="plan-library-stats">
        {(Object.keys(statuses) as Array<keyof typeof statuses>).map((status) => (
          <a
            key={status}
            href={`#plan-group-${status}`}
            onClick={(event) => {
              event.preventDefault();
              document
                .getElementById(`plan-group-${status}`)
                ?.scrollIntoView({ block: "start", behavior: "smooth" });
            }}
          >
            <span className={`plan-state-dot ${status}`} />
            <span>{statuses[status]}</span>
            <strong>{plans.filter((plan) => plan.status === status).length}</strong>
          </a>
        ))}
      </div>
      {active.length === 0 && (
        <div className="plan-quiet-state">
          <span className="plan-quiet-icon" aria-hidden="true">
            ✓
          </span>
          <div>
            <strong>{plans.length ? "当前没有待审阅或执行中的计划" : "还没有计划"}</strong>
            <p>
              {plans.length
                ? "已完成的方案与交付记录保留在下方，随时可以回看。"
                : "创建计划后，可以在这里审阅目标、任务范围与验收要求。"}
            </p>
          </div>
        </div>
      )}
      {(Object.keys(statuses) as Array<keyof typeof statuses>).map((status) => {
        const group = plans
          .filter((plan) => plan.status === status)
          .toSorted((a, b) => a.id.localeCompare(b.id));
        return (
          <section
            className={`plan-list-group${group.length ? "" : " plan-list-empty"}`}
            id={`plan-group-${status}`}
            key={status}
          >
            <h2>
              {statuses[status]} <span>{group.length}</span>
            </h2>
            {group.length ? (
              <div className="plan-list-table">
                {group.map((plan) => (
                  <a
                    className="plan-list-row"
                    href={formatRoute({
                      projectId: route.projectId,
                      view: "plans",
                      planId: plan.id,
                    })}
                    key={plan.id}
                  >
                    <span className="plan-list-title">
                      <strong>{plan.title}</strong>
                      <small>{plan.goal}</small>
                    </span>
                    <span className="plan-list-meta">
                      {plan.items.filter((item) => item.item_type === "task").length} 项任务{" "}
                      <span className={`badge badge-${status}`}>{statuses[status]}</span>
                      <span aria-hidden="true">↗</span>
                    </span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="muted">暂无计划</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function PlanDocument({ plan, route }: { plan: WorkbenchPlan; route: RouteState }) {
  const projectId = route.projectId!;
  const executionTab = route.planTab === "execution";
  const mapping = plan.materialization;
  const taskId = (key: string) => `${plan.id}--${key}`;
  const titleFor = (key: string) => plan.items.find((item) => item.key === key)?.title ?? key;
  const dependency = (ref: string) => {
    if (!ref.includes(":"))
      return (
        <span key={ref}>
          Plan 内任务：{titleFor(ref)} ({ref})
        </span>
      );
    const [target, id] = ref.split(":");
    return (
      <span key={ref}>
        既有任务：
        <a
          href={formatRoute({
            projectId: target!,
            view: "backlog",
            itemId: id!,
            returnTo: formatRoute({ projectId, view: "plans", planId: plan.id }),
          })}
        >
          {ref}
        </a>
      </span>
    );
  };
  return (
    <article className="plan-card" data-plan-id={plan.id}>
      <header className="plan-summary">
        <p className="plan-eyebrow">PLAN / {projectId}</p>
        <h1 className="plan-title" tabIndex={-1}>
          {plan.title}
        </h1>
        <div className="plan-summary-meta">
          <span className={`badge badge-${plan.status}`}>
            {plan.status === "draft" ? "草案 · 待审阅" : statuses[plan.status]}
          </span>
          <span>
            {plan.items.filter((item) => item.item_type === "task").length} 项任务 ·{" "}
            {new Set(plan.items.map((item) => item.project ?? projectId)).size} 个项目
          </span>
        </div>
      </header>
      <nav className="plan-section-nav" role="tablist" aria-label="计划视图">
        {(["review", "execution"] as const).map((tab) => (
          <a
            key={tab}
            role="tab"
            id={`${plan.id}--tab-${tab}`}
            aria-controls={`${plan.id}--panel-${tab}`}
            aria-selected={executionTab === (tab === "execution")}
            tabIndex={executionTab === (tab === "execution") ? 0 : -1}
            href={formatRoute({ ...route, planTab: tab === "execution" ? "execution" : undefined })}
          >
            {tab === "review" ? "审阅计划" : "执行与结果"}
          </a>
        ))}
      </nav>
      <div className="plan-run-notices" aria-live="polite">
        <div data-plan-run-notice />
        <div data-parallel-notice />
      </div>
      {mapping?.state === "partial" && (
        <p className="reading-notice" role="status">
          部分物化：已创建 {Object.keys(mapping.mapping).length}/{plan.items.length}{" "}
          项。核对已创建任务后，通过 CLI{" "}
          <code>
            pops plan materialize {projectId} {plan.id}
          </code>{" "}
          补齐；恢复前不可修订、完成或自动运行。
        </p>
      )}
      <section
        role="tabpanel"
        id={`${plan.id}--panel-review`}
        aria-labelledby={`${plan.id}--tab-review`}
        hidden={executionTab}
      >
        <section className="plan-review-tools" aria-label="修订计划">
          <div data-foundation-plan={plan.id} />
        </section>
        <div className="plan-review-grid">
          <div className="plan-document-body">
            <p data-plan-reading-notice role="status" />
            <section className="plan-intro" id={`${plan.id}--section-goal`}>
              <p className="plan-eyebrow">01 / OVERVIEW</p>
              <h2>计划目标</h2>
              <p className="plan-goal">{plan.goal}</p>
            </section>
            <RenderedHtml html={renderPlanGraph(plan, route)} />
            <div className="plan-reading-actions">
              <div>
                <p className="plan-eyebrow">02 / SCOPE & ACCEPTANCE</p>
                <h2>任务与验收</h2>
              </div>
              <div>
                <button className="btn btn-secondary" data-plan-expand="true">
                  全部展开
                </button>
                <button className="btn btn-secondary" data-plan-expand="false">
                  全部折叠
                </button>
              </div>
            </div>
            <div className="plan-reading-layout" id={`${plan.id}--section-tasks`}>
              <nav className="plan-toc" aria-label="任务目录">
                <button className="btn btn-secondary plan-toc-toggle" aria-expanded="false">
                  任务目录
                </button>
                <h3>任务目录</h3>
                <ol>
                  {plan.items.map((item, i) => (
                    <li key={item.key}>
                      <button
                        className="plan-toc-button"
                        data-plan-target={taskId(item.key)}
                        aria-controls={taskId(item.key)}
                      >
                        <span className="task-number">{String(i + 1).padStart(2, "0")}</span>
                        <span>
                          {item.title}
                          <small>
                            {item.depends_on.length
                              ? `依赖：${item.depends_on.map(titleFor).join("、")}`
                              : "无前置依赖"}
                          </small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </nav>
              <div className="plan-items">
                {plan.items.length ? (
                  plan.items.map((item, i) => (
                    <details
                      className="plan-task"
                      id={taskId(item.key)}
                      data-reading-key={taskId(item.key)}
                      open
                      key={item.key}
                    >
                      <summary>
                        <span className="task-number">{String(i + 1).padStart(2, "0")}</span>
                        <span className="task-heading">{item.title}</span>
                        <span className="badge badge-priority">{item.priority}</span>
                      </summary>
                      <div className="plan-task-content">
                        <div className="item-meta">
                          <span>{item.item_type === "epic" ? "Epic" : "任务"}</span>
                          <code>{item.key}</code>
                          <span>
                            目标项目：{item.project ?? projectId}
                            {item.project ? "" : "（默认 Plan 所属项目）"}
                          </span>
                          {item.parent && <span>所属：{titleFor(item.parent)}</span>}
                        </div>
                        <p className="dependency-line" aria-label="Dependencies">
                          {item.depends_on.length ? item.depends_on.map(dependency) : "无前置依赖"}
                        </p>
                        <p className="plan-downstream">
                          Plan 内下游：
                          {plan.items
                            .filter((entry) => entry.depends_on.includes(item.key))
                            .map((entry) => entry.title)
                            .join("、") || "无"}
                        </p>
                        {mapping?.mapping[item.key] && (
                          <section
                            data-plan-relations={item.key}
                            aria-label={`${item.title}的依赖关系`}
                          />
                        )}
                        <RenderedHtml
                          html={renderReadingBody(item.body, `body-${taskId(item.key)}`)}
                        />
                      </div>
                    </details>
                  ))
                ) : (
                  <p className="muted">暂无任务。</p>
                )}
              </div>
            </div>
            <details
              className="technical-details plan-records"
              data-reading-key={`records-${plan.id}`}
            >
              <summary>审批记录</summary>
              <dl>
                <dt>Plan ID</dt>
                <dd>{plan.id}</dd>
                {plan.approval ? (
                  <>
                    <dt>Approval</dt>
                    <dd>{plan.approval.review_note}</dd>
                    <dt>Approved at</dt>
                    <dd>{plan.approval.approved_at}</dd>
                  </>
                ) : (
                  <dd>尚未批准</dd>
                )}
              </dl>
            </details>
          </div>
          <aside className="plan-review-aside" aria-label="计划状态与审阅提示">
            <p className="plan-eyebrow">REVIEW DESK</p>
            <h2>
              {plan.status === "draft"
                ? "等待审阅"
                : plan.status === "done"
                  ? "交付已完成"
                  : "计划已批准"}
            </h2>
            <p>
              {plan.status === "draft"
                ? "核对目标、任务范围与验收要求，再确认方案。"
                : plan.status === "done"
                  ? "方案与执行记录已保留，可继续查看结果与交付报告。"
                  : "方案已确认，执行进度与任务验收分别记录。"}
            </p>
            <dl className="plan-facts">
              <dt>计划状态</dt>
              <dd>{statuses[plan.status]}</dd>
              <dt>任务进度</dt>
              <dd>
                {mapping
                  ? `${plan.execution.counts.done} / ${plan.execution.counts.total} 已完成`
                  : "尚未生成任务"}
              </dd>
              <dt>交付报告</dt>
              <dd>{plan.delivery_reports.length} 份</dd>
            </dl>
            <a className="btn btn-primary" href={formatRoute({ ...route, planTab: "execution" })}>
              {plan.status === "done" ? "查看交付结果" : "查看执行与结果"}
              <span aria-hidden="true"> →</span>
            </a>
            <div className="plan-review-hint">
              <strong>审阅要点</strong>
              <ul>
                <li>目标与范围是否清楚</li>
                <li>任务拆分与依赖是否合理</li>
                <li>验收要求是否可以验证</li>
              </ul>
            </div>
          </aside>
        </div>
      </section>
      <section
        role="tabpanel"
        id={`${plan.id}--panel-execution`}
        aria-labelledby={`${plan.id}--tab-execution`}
        hidden={!executionTab}
      >
        <PlanExecutionView plan={plan} projectId={projectId} />
      </section>
    </article>
  );
}
