import assert from "node:assert/strict";
import test from "node:test";
import { createWorkbenchApp } from "../src/web/app.js";
import { parseItemFile, ItemParseError } from "../src/backlog/item.js";
import type { RouteState } from "../src/web/types.js";
import { createApiClient } from "../src/web/apiClient.js";

test("workspace retry survives navigation with a previously loaded workspace", async () => {
  let route: RouteState = { projectId: null, view: "overview" };
  let notify!: (route: RouteState) => void;
  let calls = 0;
  let finishRetry!: (value: any) => void;
  const workspace = {
    workspace: { name: "test" },
    projects: [{ id: "alpha", path: "alpha" }],
    diagnostics: [],
  };
  const handlers: Record<string, (event: any) => void> = {};
  const container = {
    innerHTML: "",
    addEventListener: (name: string, handler: any) => {
      handlers[name] = handler;
    },
    removeEventListener() {},
  };
  const app = createWorkbenchApp({
    container: container as unknown as HTMLElement,
    apiClient: {
      ...createApiClient(),
      getWorkspaceOverview: async () => {
        calls++;
        if (calls === 1) return { ok: true, data: workspace };
        if (calls === 2) return { ok: false, error: { message: "disconnected" } };
        return new Promise((resolve) => {
          finishRetry = resolve;
        });
      },
      getProjectOverview: async () => ({ ok: false, error: { message: "project unavailable" } }),
    },
    router: (onChange) => {
      notify = onChange;
      return { getCurrentRoute: () => route, navigate() {}, cleanup() {} };
    },
  });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    await app.refresh();
    handlers.click!({
      target: { closest: (selector: string) => (selector === "#btn-retry" ? {} : null) },
      preventDefault() {},
    });
    route = { projectId: "alpha", view: "overview" };
    notify(route);
    await new Promise((resolve) => setImmediate(resolve));
    finishRetry({ ok: true, data: workspace });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(app.getState().status, "ready");
    assert.equal(app.getState().selectedProjectId, "alpha");
    assert.doesNotMatch(container.innerHTML, /Loading Workbench/);
  } finally {
    app.destroy();
  }
});

test("Backlog parser rejects malformed typed fields before they reach Workbench", () => {
  for (const field of [
    "depends_on: [123]",
    "title: [123]",
    "status: unknown",
    'title: "unterminated',
  ]) {
    assert.throws(
      () => parseItemFile(`---\nid: A-001\n${field}\n---\nbody`),
      ItemParseError,
      field,
    );
  }
});
