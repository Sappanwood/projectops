import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "../src/web/markdown.js";

test("reading view gives headings, lists, emphasis, code and links semantic markup", () => {
  const html = renderMarkdown(
    '## 验收标准\n\n正文 **重点** 与 `code`。\n\n- 一项\n- 二项\n\n1. 步骤\n2. 完成\n\n```ts\nconst x = "<safe>";\n```\n\n[文档](https://example.com/docs)',
  );
  assert.match(html, /<h3>验收标准<\/h3>/);
  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<ul><li>一项<\/li><li>二项<\/li><\/ul>/);
  assert.match(html, /<ol[^>]*><li>步骤<\/li><li>完成<\/li><\/ol>/);
  assert.match(html, /<pre><code>const x = &quot;&lt;safe&gt;&quot;;/);
  assert.match(html, /href="https:\/\/example.com\/docs"/);
});

test("reading view keeps raw HTML inert and does not activate unsafe or local links", () => {
  const html = renderMarkdown(
    "<script>alert(1)</script>\n\n[bad](javascript:alert) [encoded](javascript&#58;alert) [file](file:///tmp/secret) [relative](docs/readme.md)\n\n<img src=x onerror=alert(1)>",
  );
  assert.doesNotMatch(html, /<script|<img|href=/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /docs\/readme.md/);
});

test("nested lists and long inline input remain readable without interpreting markup in code", () => {
  const html = renderMarkdown(
    "- Parent\n  - Child **bold**\n- Other\n\n`**literal**`\n\n```\n# literal\n```",
  );
  assert.match(html, /Parent<ul><li>Child <strong>bold<\/strong><\/li><\/ul>/);
  assert.match(html, /<code>\*\*literal\*\*<\/code>/);
  assert.match(html, /<pre><code># literal/);
});

test("document reading renders tables, quotes, task lists and separators", () => {
  const html = renderMarkdown(
    "| 名称 | 结果 |\n| --- | --- |\n| **检查** | `passed` |\n\n> 引用\n> 第二行\n\n- [x] 完成\n- [ ] 待办\n\n---",
  );
  assert.match(html, /<table>/);
  assert.match(html, /<th>名称<\/th>/);
  assert.match(html, /<td><strong>检查<\/strong><\/td>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /type="checkbox" disabled checked/);
  assert.match(html, /type="checkbox" disabled>/);
  assert.match(html, /<hr>/);
});
