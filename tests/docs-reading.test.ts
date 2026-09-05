import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "../src/app.js";
import { startWorkbenchServer } from "../src/server/workbenchServer.js";

test("Docs HTTP lists standard and nested Markdown and reads one document without writing", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "pops-doc-reader-"));
  let server;
  try {
    const io = {stdout() {}, stderr(s: string) { throw new Error(s); }};
    assert.equal(runCli(["init"], io, root), 0);
    mkdirSync(path.join(root, "alpha/docs/guide"), {recursive:true});
    assert.equal(runCli(["project", "add", "alpha"], io, root), 0);
    const body = 'Text without heading\n\n| A | B |\n| --- | --- |\n| one | two |\n';
    writeFileSync(path.join(root, "alpha/docs/guide/use.md"), body);
    writeFileSync(path.join(root, "alpha/docs/secret.txt"), "PRIVATE");
    writeFileSync(path.join(root, "outside.md"), "OUTSIDE");
    symlinkSync(path.join(root, "outside.md"), path.join(root, "alpha/docs/escape.md"));
    mkdirSync(path.join(root, "outside"));
    writeFileSync(path.join(root, "outside/hidden.md"), "HIDDEN");
    symlinkSync(path.join(root, "outside"), path.join(root, "alpha/docs/linked"));
    server = await startWorkbenchServer({workspaceDir:root, port:0});
    const base = `${server.origin}/api/projects/alpha/docs`;
    const list = await fetch(base);
    assert.equal(list.status, 200);
    const data = (await list.json()).data;
    assert.deepEqual(data.documents.slice(0,4).map((d: {path:string}) => d.path), ["README.md","AGENTS.md","docs/PRODUCT_SPEC.md","docs/ARCHITECTURE.md"]);
    assert.ok(data.documents.some((d: {path:string}) => d.path === 'docs/guide/use.md'));
    assert.ok(!JSON.stringify(data).includes('PRIVATE'));
    assert.ok(!JSON.stringify(data).includes('HIDDEN'));
    const response = await fetch(`${base}?path=${encodeURIComponent('docs/guide/use.md')}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.body, body);
    for (const filename of ['../outside.md', '/etc/passwd', 'docs/../outside.md', 'docs/escape.md', 'docs/linked/hidden.md', 'docs/secret.txt']) {
      const bad = await fetch(`${base}?path=${encodeURIComponent(filename)}`);
      assert.ok(bad.status >= 400, filename);
      assert.doesNotMatch(await bad.text(), /OUTSIDE|HIDDEN|PRIVATE/);
    }
    assert.equal((await fetch(`${base}?path=README.md`)).status,404);
    assert.equal((await fetch(`${base}?path=x&path=y`)).status,400);
    assert.equal((await fetch(base,{method:'POST'})).status,405);
    assert.equal((await fetch(`${server.origin}/api/projects/missing/docs`)).status,404);
    assert.equal(readFileSync(path.join(root, 'alpha/docs/guide/use.md'),'utf8'),body);
  } finally { await server?.close(); rmSync(root,{recursive:true,force:true}); }
});
