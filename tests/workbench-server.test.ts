import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "../src/app.js";
import {
  WorkbenchServerStartError,
  startWorkbenchServer,
  type WorkbenchServer,
} from "../src/server/workbenchServer.js";

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), "pops-workbench-server-"));
}

function run(args: string[], cwd: string): { code: number; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = runCli(
    args,
    {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    },
    cwd,
  );
  return { code, stdout, stderr };
}

function setupWorkspace(): { workspaceDir: string; itemId: string; revision: string } {
  const workspaceDir = freshDir();
  assert.equal(run(["init"], workspaceDir).code, 0);
  mkdirSync(path.join(workspaceDir, "repo-a"));
  assert.equal(run(["project", "add", "repo-a"], workspaceDir).code, 0);
  assert.equal(run(["backlog", "init", "repo-a"], workspaceDir).code, 0);
  const added = run(
    [
      "backlog",
      "add",
      "repo-a",
      "-T",
      "Serve Workbench",
      "-c",
      "feature",
      "--priority",
      "P1",
      "-b",
      "Expose the local API.",
      "--json",
    ],
    workspaceDir,
  );
  assert.equal(added.code, 0);
  const receipt = JSON.parse(added.stdout[0] ?? "null") as {
    item: { id: string; revision: string };
  };
  return {
    workspaceDir,
    itemId: receipt.item.id,
    revision: receipt.item.revision,
  };
}

type HttpResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
};

function request(
  origin: string,
  pathname: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      new URL(pathname, origin),
      { method: options.method ?? "GET", headers: options.headers, agent: false },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body,
          }),
        );
      },
    );
    request.on("error", reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

function json(response: HttpResponse): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

async function close(server: WorkbenchServer | undefined): Promise<void> {
  if (server?.listening) await server.close();
}

test("Workbench server exposes fixed-workspace overview and Backlog routes", async () => {
  const { workspaceDir, itemId, revision } = setupWorkspace();
  const server = await startWorkbenchServer({ workspaceDir, port: 0 });

  try {
    assert.equal(server.host, "127.0.0.1");
    assert.equal(server.listening, true);

    const workspaceResponse = await request(server.origin, "/api/workspace");
    assert.equal(workspaceResponse.status, 200);
    const workspace = json(workspaceResponse);
    assert.equal(workspace.ok, true);
    assert.equal(JSON.stringify(workspace).includes(workspaceDir), false);

    const projectResponse = await request(server.origin, "/api/projects/repo-a");
    assert.equal(projectResponse.status, 200);
    const project = json(projectResponse);
    assert.equal(project.ok, true);

    const listResponse = await request(server.origin, "/api/projects/repo-a/backlog");
    assert.equal(listResponse.status, 200);
    const list = json(listResponse) as { ok: boolean; data: { items: Array<{ id: string }> } };
    assert.deepEqual(
      list.data.items.map((item) => item.id),
      [itemId],
    );

    const showResponse = await request(server.origin, `/api/projects/repo-a/backlog/${itemId}`);
    assert.equal(showResponse.status, 200);
    const shown = json(showResponse) as {
      ok: boolean;
      data: { item: { revision: string } };
    };
    assert.equal(shown.data.item.revision, revision);

    // Corrupted item file returns 422 ITEM_INVALID instead of 500
    writeFileSync(
      path.join(workspaceDir, "ops", "repo-a", "backlog", "items", `${itemId}.md`),
      "bad markdown without frontmatter",
      "utf8",
    );
    const corruptListResponse = await request(server.origin, "/api/projects/repo-a/backlog");
    assert.equal(corruptListResponse.status, 422);
    const corruptList = json(corruptListResponse) as { ok: boolean; error: { code: string } };
    assert.equal(corruptList.ok, false);
    assert.equal(corruptList.error.code, "ITEM_INVALID");

    const corruptShowResponse = await request(
      server.origin,
      `/api/projects/repo-a/backlog/${itemId}`,
    );
    assert.equal(corruptShowResponse.status, 422);
    const corruptShow = json(corruptShowResponse) as { ok: boolean; error: { code: string } };
    assert.equal(corruptShow.ok, false);
    assert.equal(corruptShow.error.code, "ITEM_INVALID");
  } finally {
    await close(server);
  }

  assert.equal(server.listening, false);
});

test("Workbench server protects mutations and maps stale revisions", async () => {
  const { workspaceDir, itemId, revision } = setupWorkspace();
  const server = await startWorkbenchServer({ workspaceDir, port: 0 });

  try {
    const updateResponse = await request(server.origin, `/api/projects/repo-a/backlog/${itemId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json; charset=utf-8",
        origin: server.origin,
      },
      body: JSON.stringify({ status: "in_progress", expected_revision: revision }),
    });
    assert.equal(updateResponse.status, 200);
    const updated = json(updateResponse) as {
      ok: boolean;
      data: { result: { status: string; revision: string } };
    };
    assert.equal(updated.data.result.status, "in_progress");
    assert.notEqual(updated.data.result.revision, revision);

    const staleResponse = await request(server.origin, `/api/projects/repo-a/backlog/${itemId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: server.origin },
      body: JSON.stringify({ status: "done", expected_revision: revision }),
    });
    assert.equal(staleResponse.status, 409);
    const stale = json(staleResponse) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, "REVISION_MISMATCH");
    assert.equal(stale.error.message.includes(workspaceDir), false);
  } finally {
    await close(server);
  }
});

test("Workbench server rejects invalid methods, media types, origins, and workspace switching", async () => {
  const { workspaceDir, itemId } = setupWorkspace();
  const server = await startWorkbenchServer({ workspaceDir, port: 0 });

  try {
    const cases: Array<{
      path: string;
      init?: { method?: string; headers?: Record<string, string>; body?: string };
      status: number;
      code: string;
    }> = [
      {
        path: "/api/workspace?workspace=/tmp/other",
        status: 400,
        code: "INVALID_REQUEST",
      },
      {
        path: "/api/workspace",
        init: { method: "POST" },
        status: 405,
        code: "METHOD_NOT_ALLOWED",
      },
      {
        path: `/api/projects/repo-a/backlog/${itemId}`,
        init: { method: "PATCH", headers: { "content-type": "text/plain" }, body: "{}" },
        status: 415,
        code: "UNSUPPORTED_MEDIA_TYPE",
      },
      {
        path: `/api/projects/repo-a/backlog/${itemId}`,
        init: {
          method: "PATCH",
          headers: { "content-type": "application/json", origin: "https://example.com" },
          body: JSON.stringify({ status: "done" }),
        },
        status: 403,
        code: "ORIGIN_NOT_ALLOWED",
      },
      {
        path: `/api/projects/repo-a/backlog/${itemId}`,
        init: {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: "{",
        },
        status: 400,
        code: "INVALID_JSON",
      },
      {
        path: `/api/projects/repo-a/backlog/${itemId}`,
        init: {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "done", workspace: "/tmp/other" }),
        },
        status: 400,
        code: "INVALID_REQUEST",
      },
      {
        path: "/api/unknown",
        status: 404,
        code: "ROUTE_NOT_FOUND",
      },
    ];

    for (const entry of cases) {
      const response = await request(server.origin, entry.path, entry.init);
      assert.equal(response.status, entry.status, entry.path);
      const body = json(response) as { error: { code: string }; stack?: string };
      assert.equal(body.error.code, entry.code, entry.path);
      assert.equal(body.stack, undefined);
      assert.equal(JSON.stringify(body).includes(workspaceDir), false);
    }
  } finally {
    await close(server);
  }
});

test("Workbench server serves static assets from an explicit root", async () => {
  const { workspaceDir } = setupWorkspace();
  const staticDir = freshDir();
  writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><title>Workbench</title>");
  writeFileSync(path.join(staticDir, "app.js"), "console.log('workbench');\n");
  const server = await startWorkbenchServer({ workspaceDir, port: 0, staticDir });

  try {
    const index = await request(server.origin, "/");
    assert.equal(index.status, 200);
    assert.match(index.headers["content-type"] ?? "", /^text\/html/);
    assert.match(index.body, /Workbench/);

    const script = await request(server.origin, "/app.js");
    assert.equal(script.status, 200);
    assert.match(script.headers["content-type"] ?? "", /^text\/javascript/);
  } finally {
    await close(server);
  }
});

test("Workbench server automatically serves built production frontend when staticDir is omitted", async () => {
  const { workspaceDir } = setupWorkspace();
  const server = await startWorkbenchServer({ workspaceDir, port: 0 });

  try {
    const index = await request(server.origin, "/");
    assert.equal(index.status, 200);
    assert.match(index.headers["content-type"] ?? "", /^text\/html/);
    assert.match(index.body, /<title>ProjectOps Workbench<\/title>/);
    assert.match(index.body, /<div id="app"><\/div>/);

    const css = await request(server.origin, "/style.css");
    assert.equal(css.status, 200);
    assert.match(css.headers["content-type"] ?? "", /^text\/css/);
    assert.match(css.body, /--bg-primary/);

    const appJs = await request(server.origin, "/app.js");
    assert.equal(appJs.status, 200);
    assert.match(appJs.headers["content-type"] ?? "", /^text\/javascript/);
  } finally {
    await close(server);
  }
});

test("Workbench server enforces loopback and reports a stable port conflict", async () => {
  const { workspaceDir } = setupWorkspace();
  let first: WorkbenchServer | undefined;

  try {
    await assert.rejects(
      startWorkbenchServer({ workspaceDir, host: "0.0.0.0", port: 0 }),
      (error: unknown) => {
        assert.ok(error instanceof WorkbenchServerStartError);
        assert.equal(error.code, "INVALID_HOST");
        return true;
      },
    );
    first = await startWorkbenchServer({ workspaceDir, port: 0 });
    await assert.rejects(
      startWorkbenchServer({ workspaceDir, port: first.port }),
      (error: unknown) => {
        assert.ok(error instanceof WorkbenchServerStartError);
        assert.equal(error.code, "PORT_UNAVAILABLE");
        assert.equal(error.message, `Port ${first?.port ?? 0} is unavailable on 127.0.0.1.`);
        assert.equal(error.message.includes(workspaceDir), false);
        return true;
      },
    );
  } finally {
    await close(first);
  }
});
