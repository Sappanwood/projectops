import assert from "node:assert/strict";
import test from "node:test";
import type { WorkbenchReadPages } from "../src/application/workbenchReadModel.js";
import { renderReadPages } from "./helpers/webRender.js";

test("Reports and Retrospectives put rendered bodies before technical records", () => {
  const data: WorkbenchReadPages = {
    plans: [],
    documents: [],
    diagnostics: [],
    reports: [
      {
        schema: "report/Report@1",
        id: "report-reading",
        title: "Reading",
        project: "alpha",
        created_at: "2026-09-05",
        outcome: "completed",
        plan: "project-ops:plans/plan-reading.json",
        backlog: [],
        verification: ["Passed"],
        deviations: [],
        workarounds: [],
        repo_docs: [],
        body: "## Evidence\n**Report body**",
      },
    ],
    retrospectives: [
      {
        schema: "retrospective/Retrospective@1",
        id: "retro-reading",
        project: "alpha",
        task: null,
        created_at: "2026-09-05",
        trigger: "workflow-friction",
        status: "inbox",
        harness: "test",
        model: null,
        path: "inbox/retro-reading.md",
        revision: "revision-123",
        body: "## Friction\n**Retro body**",
      },
    ],
  };
  for (const view of ["reports", "retrospectives"] as const) {
    const html = renderReadPages(view, data, { project: "alpha", status: "", task: "" });
    assert.match(html, /class="markdown-content"/);
    assert.match(html, /<strong>(Report|Retro) body<\/strong>/);
    assert.match(html, /查看 Markdown 源码/);
    assert.ok(html.indexOf('class="markdown-reader"') < html.indexOf('class="technical-details'));
  }
  data.retrospectives[0]!.project = "beta";
  data.retrospectives[0]!.backlog = ["project-ops:backlog/items/BET-001.md"];
  const crossProject = renderReadPages(
    "retrospectives",
    data,
    { project: "", status: "", task: "" },
    { projectId: "alpha", planId: null },
  );
  assert.match(crossProject, /href="#\/projects\/beta\/backlog\/BET-001\?from=/);
});
