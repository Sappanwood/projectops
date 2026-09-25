import assert from "node:assert/strict";
import test from "node:test";
import { renderBacklogPanel } from "./helpers/webRender.js";

test("done backlog items are inside a collapsed counted details group", () => {
  const html = renderBacklogPanel({
    projectId: "alpha",
    items: [
      {
        id: "ALP-001",
        project: "alpha",
        title: "Active task",
        item_type: "task",
        parent_id: null,
        category: "feature",
        priority: "P1",
        effort: "M",
        impact: "medium",
        status: "todo",
        source: "",
        fixed_at: null,
        tags: [],
        depends_on: [],
        related_docs: [],
        created: "2026-09-06",
        updated: "2026-09-06",
        revision: "todo-rev",
      },
      {
        id: "ALP-002",
        project: "alpha",
        title: "Finished task",
        item_type: "task",
        parent_id: null,
        category: "feature",
        priority: "P2",
        effort: "M",
        impact: "medium",
        status: "done",
        source: "",
        fixed_at: null,
        tags: [],
        depends_on: [],
        related_docs: [],
        created: "2026-09-06",
        updated: "2026-09-06",
        revision: "done-rev",
      },
    ],
    selectedItemId: null,
    item: null,
    loading: false,
    detailLoading: false,
    saving: false,
    error: null,
    detailError: null,
    message: null,
  });

  assert.match(html, /<details class="backlog-group" data-reading-key="backlog-group-done">/);
  assert.doesNotMatch(html, /backlog-group-done[^>]* open/);
  assert.match(html, /已完成 <span class="group-count">1<\/span>/);
  assert.match(html, /ALP-002/);
  assert.match(html, /ALP-001/);
});

test("a deep-linked done item opens its group so the target remains visible", () => {
  const html = renderBacklogPanel({
    projectId: "alpha",
    items: [
      {
        id: "ALP-002",
        project: "alpha",
        title: "Finished task",
        item_type: "task",
        parent_id: null,
        category: "feature",
        priority: "P2",
        effort: "M",
        impact: "medium",
        status: "done",
        source: "",
        fixed_at: null,
        tags: [],
        depends_on: [],
        related_docs: [],
        created: "2026-09-06",
        updated: "2026-09-06",
        revision: "done-rev",
      },
    ],
    selectedItemId: "ALP-002",
    item: null,
    loading: false,
    detailLoading: true,
    saving: false,
    error: null,
    detailError: null,
    message: null,
  });

  assert.match(html, /data-reading-key="backlog-group-done" open/);
});
