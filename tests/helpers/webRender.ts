import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkbenchReadPages } from "../../src/application/workbenchReadModel.js";
import { ReportsPage, RetrospectivesPage } from "../../src/web/artifactView.js";
import type { BacklogViewState } from "../../src/web/backlogController.js";
import { BacklogPage } from "../../src/web/backlogView.js";
import { DocumentLibrary } from "../../src/web/documentView.js";
import { PlansPage } from "../../src/web/planView.js";
import type { ReadPage, RetrospectiveFilters } from "../../src/web/readPagesView.js";
import { renderDiagnostics } from "../../src/web/render.js";
import type { AppState, RouteState } from "../../src/web/types.js";
import { ProjectNavigation, Workbench, WorkbenchHeader } from "../../src/web/workbenchReact.js";

export { escapeHtml, renderDiagnostics } from "../../src/web/render.js";
export const renderApp = (state: AppState) =>
  renderToStaticMarkup(createElement(Workbench, { state }));
export const renderHeader = (state: AppState) =>
  renderToStaticMarkup(createElement(WorkbenchHeader, { state }));
export const renderProjectNav = (state: AppState) =>
  renderToStaticMarkup(createElement(ProjectNavigation, { state }));
export const renderBacklogPanel = (state: BacklogViewState) =>
  renderToStaticMarkup(createElement(BacklogPage, { state }));
export function renderReadPages(
  view: ReadPage,
  data: WorkbenchReadPages,
  filters: RetrospectiveFilters,
  context?: {
    projectId: string;
    planId: string | null;
    reportId?: string | null;
    route?: RouteState;
  },
) {
  const route: RouteState = context?.route ?? {
    projectId: context?.projectId ?? filters.project,
    view,
    ...(context?.planId ? { planId: context.planId } : {}),
    ...(context?.reportId ? { reportId: context.reportId } : {}),
  };
  const content =
    view === "plans"
      ? createElement(PlansPage, { plans: data.plans, route })
      : view === "reports"
        ? createElement(ReportsPage, { reports: data.reports, route })
        : view === "retrospectives"
          ? createElement(RetrospectivesPage, { records: data.retrospectives, filters, route })
          : createElement(DocumentLibrary, {
              library: "docs",
              route,
              state: {
                loading: false,
                error: null,
                listError: null,
                document: null,
                list: {
                  documents: data.documents.map((document) => ({ ...document, standard: true })),
                  diagnostics: [],
                },
              },
            });
  return (
    renderDiagnostics(
      data.diagnostics.filter(
        (d) => d.source === view || (view === "plans" && d.source === "reports"),
      ),
      `${view} diagnostics`,
    ) + renderToStaticMarkup(content)
  );
}
