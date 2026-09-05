import assert from "node:assert/strict";
import test from "node:test";
import { parseRoute, formatRoute } from "../src/web/router.js";

test("Plan and Backlog detail routes preserve same-project return context", () => {
  for (const [hash, route] of [
    ["#/projects/alpha/plans/plan-navigation", { projectId: "alpha", view: "plans", planId: "plan-navigation" }],
    ["#/projects/alpha/backlog/ALP-002?plan=plan-navigation", { projectId: "alpha", view: "backlog", itemId: "ALP-002", planId: "plan-navigation" }],
    ["#/projects/alpha/reports/report-delivery?plan=plan-navigation", { projectId: "alpha", view: "reports", reportId: "report-delivery", planId: "plan-navigation" }],
  ] as const) {
    assert.deepEqual(parseRoute(hash), route);
    assert.equal(formatRoute(route), hash);
  }
});
