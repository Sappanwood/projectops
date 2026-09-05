import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REPORT_SCHEMA,
  parseReport,
  serializeReport,
  type Report,
} from "../src/report/report.js";
import {
  ReportAlreadyExistsError,
  ReportParseError,
  ReportRootError,
  ReportTargetError,
  listReportIds,
  readReport,
  writeReport,
} from "../src/report/reportFs.js";
import { resolveReportsRoot } from "../src/useCases/reportContext.js";
import { runCli } from "../src/app.js";

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), "pops-report-"));
}

function run(args: string[], cwd: string): { code: number; stderr: string[] } {
  const stderr: string[] = [];
  const code = runCli(args, { stdout: () => undefined, stderr: (message) => stderr.push(message) }, cwd);
  return { code, stderr };
}

function validReport(): Report {
  return {
    schema: REPORT_SCHEMA,
    id: "report-release-workflow",
    title: "Release workflow",
    project: "repo-a",
    created_at: "2026-09-04T12:00:00+09:00",
    outcome: "completed",
    plan: "project-ops:plans/plan-release-workflow.json",
    backlog: [
      { id: "REPO-001", status: "done", revision: "abc12345" },
    ],
    verification: ["npm test", "npm run typecheck"],
    deviations: [],
    workarounds: [],
    repo_docs: ["docs/PRODUCT_SPEC.md", "docs/ARCHITECTURE.md"],
    body: "## Delivery summary\n\nReleased the workflow.",
  };
}

test("Report schema parses required delivery evidence and serializes deterministically", () => {
  const report = validReport();
  const serialized = serializeReport(report);

  assert.match(serialized, /^---\nschema: report\/Report@1\n/);
  assert.match(serialized, /plan: project-ops:plans\/plan-release-workflow\.json/);
  assert.doesNotMatch(serialized, /\/tmp\/|\/home\/|\\\\/);
  assert.equal(serializeReport(report), serialized);
  assert.deepEqual(parseReport(serialized), report);
});

test("Report parser rejects an invalid schema and missing required fields", () => {
  const report = validReport();
  assert.throws(
    () => serializeReport({ ...report, schema: "report/Report@999" as typeof REPORT_SCHEMA }),
    /unexpected report schema/i,
  );

  assert.match(String(parseReport({ ...report, outcome: undefined })), /outcome/i);
});

test("Report filesystem adapter creates, lists, reads, and never overwrites a report", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "ops", "repo-a", "reports");
  mkdirSync(root, { recursive: true });
  const report = validReport();

  writeReport(workspace, root, report);
  assert.deepEqual(listReportIds(workspace, root), [report.id]);
  assert.deepEqual(readReport(workspace, root, report.id), report);
  const reportPath = path.join(root, `${report.id}.md`);
  const original = readFileSync(reportPath, "utf8");

  assert.throws(() => writeReport(workspace, root, report), ReportAlreadyExistsError);
  assert.equal(readFileSync(reportPath, "utf8"), original);
  rmSync(workspace, { recursive: true, force: true });
});

test("Report adapter rejects missing, non-directory, non-regular, and escaping roots", () => {
  const workspace = freshDir();
  const report = validReport();

  assert.throws(
    () => writeReport(workspace, path.join(workspace, "missing"), report),
    (error: unknown) => error instanceof ReportRootError && /does not exist/i.test(error.message),
  );
  assert.throws(() => listReportIds(workspace, path.join(workspace, "missing")), ReportRootError);
  assert.throws(() => readReport(workspace, path.join(workspace, "missing"), report.id), ReportRootError);

  const fileRoot = path.join(workspace, "file-root");
  writeFileSync(fileRoot, "not a directory", "utf8");
  assert.throws(() => writeReport(workspace, fileRoot, report), /reports root.*directory/i);

  const outside = freshDir();
  assert.throws(() => listReportIds(workspace, outside), /outside the workspace/i);
  assert.throws(() => readReport(workspace, outside, report.id), /outside the workspace/i);
  const escapeRoot = path.join(workspace, "reports");
  symlinkSync(outside, escapeRoot, "dir");
  assert.throws(() => writeReport(workspace, escapeRoot, report), /outside the workspace/i);

  const regularRoot = path.join(workspace, "regular-root");
  mkdirSync(regularRoot);
  const target = path.join(regularRoot, `${report.id}.md`);
  mkdirSync(path.join(regularRoot, "nested"));
  symlinkSync(path.join(regularRoot, "nested"), target, "dir");
  assert.throws(() => readReport(workspace, regularRoot, report.id), ReportTargetError);

  rmSync(workspace, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test("Report adapter does not treat malformed files as valid records", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "reports");
  mkdirSync(root, { recursive: true });
  const id = "report-broken";
  writeFileSync(path.join(root, `${id}.md`), "---\nschema: report/Report@1\nid: report-broken\n---\n", "utf8");

  assert.throws(() => readReport(workspace, root, id), ReportParseError);
  assert.deepEqual(listReportIds(workspace, root), [id]);
  rmSync(workspace, { recursive: true, force: true });
});

test("Report serialization rejects absolute logical references", () => {
  const report = validReport();
  assert.throws(() => serializeReport({ ...report, plan: "/home/ling/plan.json" }), /logical reference/i);
  assert.throws(
    () => serializeReport({ ...report, backlog: [{ id: "REPO-001", status: "done", revision: "abc12345", uri: "/tmp/item.md" }] }),
    /logical reference|absolute path/i,
  );
});

test("Report repo docs are repository-relative paths and reject namespaced references", () => {
  assert.deepEqual(parseReport(serializeReport({ ...validReport(), repo_docs: ["README.md", "docs/ARCHITECTURE.md"] })), {
    ...validReport(),
    repo_docs: ["README.md", "docs/ARCHITECTURE.md"],
  });
  assert.throws(
    () => serializeReport({ ...validReport(), repo_docs: ["project-ops:repo/README.md"] }),
    /repo-relative logical reference/i,
  );
});

test("Report rejects machine absolute paths in all persisted string fields", () => {
  const fields = [
    "title",
    "project",
    "verification",
    "deviations",
    "workarounds",
    "body",
  ] as const;
  for (const field of fields) {
    const value = Array.isArray(validReport()[field]) ? ["/tmp/secret"] : "/tmp/secret";
    assert.throws(() => serializeReport({ ...validReport(), [field]: value }), /absolute path/i, field);
  }
  assert.throws(() => serializeReport({ ...validReport(), title: "C:/Users/ling/report.md" }), /absolute path/i);
  assert.throws(() => serializeReport({ ...validReport(), body: "See C:\\Users\\ling\\report.md" }), /absolute path/i);
  assert.throws(() => serializeReport({ ...validReport(), repo_docs: ["/repo/docs/README.md"] }), /logical reference|absolute path/i);
  assert.throws(() => serializeReport({ ...validReport(), repo_docs: [""] }), /logical reference/i);
});

test("Report preserves legal URL, Markdown, HTML, and slash text", () => {
  for (const body of [
    "https://example.com/evidence",
    "[section](/guide)",
    "<details>ok</details>",
    "completed / partial",
  ]) {
    const report = { ...validReport(), body };
    assert.deepEqual(parseReport(serializeReport(report)), report, body);
  }
});

test("Report accepts Unicode word separators and still rejects embedded absolute paths", () => {
  for (const body of ["文本/JSON", "编辑/审批", "café/JSON", "说明：文本/JSON 与编辑/审批"]) {
    const report = { ...validReport(), body, verification: [body] };
    assert.deepEqual(parseReport(serializeReport(report)), report, body);
  }
  for (const body of ["文件：/tmp/report.md", "文件 /home/user/report.md", "路径 `/tmp/report.md`", "路径 C:\\Users\\user\\report.md"]) {
    assert.throws(() => serializeReport({ ...validReport(), body }), /absolute path/i, body);
  }
});

test("Report round trip removes trailing body whitespace but preserves internal whitespace", () => {
  const body = "## Summary\n\n文本中间  保留空白\n\n完成。";
  const report = { ...validReport(), body: `${body}  \n\n` };
  assert.deepEqual(parseReport(serializeReport(report)), { ...report, body });
});

test("Report root resolver requires the registered reports descriptor", () => {
  const workspace = freshDir();
  assert.equal(run(["init"], workspace).code, 0);
  mkdirSync(path.join(workspace, "repo-a"));
  assert.equal(run(["project", "add", "repo-a"], workspace).code, 0);
  const manifestPath = path.join(workspace, ".pops", "workspace.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    artifact_layout: { roots: Record<string, string> };
  };
  const errors: string[] = [];
  const io = { stdout: () => undefined, stderr: (message: string) => errors.push(message) };

  delete manifest.artifact_layout.roots.reports;
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
  assert.equal(resolveReportsRoot("repo-a", io, workspace, true), null);
  assert.match(errors.at(-1) ?? "", /reports artifact type/i);

  manifest.artifact_layout.roots.reports = "markdown/other@1";
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
  assert.equal(resolveReportsRoot("repo-a", io, workspace, true), null);
  assert.match(errors.at(-1) ?? "", /reports artifact type/i);
  rmSync(workspace, { recursive: true, force: true });
});
