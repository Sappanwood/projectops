import assert from "node:assert/strict";
import test from "node:test";
import { formatRoute, parseRoute } from "../src/web/router.js";
import { documentLink } from "../src/web/docsView.js";

test("Overview is a valid return destination for every detail route", () => {
  for (const returnTo of ["#/projects/alpha", "#/projects/alpha/overview"]) {
    const route = { projectId: "alpha", view: "backlog" as const, itemId: "ALP-001", returnTo };
    assert.deepEqual(parseRoute(formatRoute(route)), route);
  }
  for (const returnTo of [
    "https://evil.test",
    "#/projects/alpha/unknown",
    "#/projects/alpha/overview/extra",
  ]) {
    assert.equal(
      parseRoute(formatRoute({ projectId: "alpha", view: "plans", returnTo })).returnTo,
      undefined,
    );
  }
});

test("Retrospective details preserve filters and bounded return routes", () => {
  const hash =
    "#/projects/alpha/retrospectives/retro-reading?filter_project=alpha&status=inbox&task=ALP-001";
  const route = parseRoute(hash);
  assert.equal(route.retrospectiveId, "retro-reading");
  assert.deepEqual(route.retrospectiveFilters, {
    project: "alpha",
    status: "inbox",
    task: "ALP-001",
  });
  assert.deepEqual(parseRoute(formatRoute(route)), route);
  const task = parseRoute(`#/projects/alpha/backlog/ALP-001?from=${encodeURIComponent(hash)}`);
  assert.equal(task.returnTo, hash);
  assert.equal(
    parseRoute("#/projects/alpha/docs?from=https%3A%2F%2Fevil.test").returnTo,
    undefined,
  );
});

test("Document links resolve against the current document and preserve application routing", () => {
  const route = { projectId: "alpha", view: "docs" as const, documentPath: "docs/guide/use.md" };
  assert.equal(parseRoute(documentLink("../../README.md#概览", route)!).documentPath, "README.md");
  assert.equal(parseRoute(documentLink("#步骤", route)!).section, "步骤");
  for (const link of [
    "../../../outside.md",
    "file:///tmp/a.md",
    "javascript:alert(1)",
    "/etc/a.md",
    "%2fetc/a.md",
    "other.txt",
    "..%5c..%5coutside.md",
  ])
    assert.equal(documentLink(link, route), null, link);
});
