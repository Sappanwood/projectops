import { escapeHtml as e } from "./render.js";

export type MarkdownOptions = {
  headingId?: (title: string, level: number) => string;
  resolveLink?: (url: string) => string | null;
};

// A deliberately small reading subset; all unrecognized syntax stays text.
function inline(text: string, options: MarkdownOptions): string {
  const tokens = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  let html = "";
  let offset = 0;
  for (const match of text.matchAll(tokens)) {
    html += e(text.slice(offset, match.index));
    if (match[1] !== undefined) html += `<code>${e(match[1])}</code>`;
    else if (match[2] !== undefined) {
      const url = match[3]!;
      const internal = options.resolveLink?.(url);
      html += /^https?:\/\//i.test(url)
        ? `<a href="${e(url)}" target="_blank" rel="noopener noreferrer">${e(match[2])}</a>`
        : internal?.startsWith("#/projects/") ? `<a href="${e(internal)}">${e(match[2])}</a>`
        : `<span title="无法在工作台打开此链接">${e(match[2])} <code>${e(url)}</code></span>`;
    } else if (match[4] !== undefined) html += `<strong>${e(match[4])}</strong>`;
    else html += `<em>${e(match[5]!)}</em>`;
    offset = match.index! + match[0].length;
  }
  return html + e(text.slice(offset));
}

export function renderMarkdown(body: string, options: MarkdownOptions = {}): string {
  const inlineText = (text: string) => inline(text, options);
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const listMatch = (line: string) => /^( *)([-+*]|\d+\.)\s+(.+)$/.exec(line);
  let i = 0;
  function list(indent: number): string {
    const first = listMatch(lines[i]!)!;
    const ordered = /^\d/.test(first[2]!);
    const tag = ordered ? "ol" : "ul";
    let html = `<${tag}${ordered && first[2] !== "1." ? ` start="${parseInt(first[2]!, 10)}"` : ""}>`;
    while (i < lines.length) {
      const match = listMatch(lines[i]!);
      if (!match || match[1]!.length !== indent || /^\d/.test(match[2]!) !== ordered) break;
      const task = /^\[([ xX])\]\s+(.+)$/.exec(match[3]!);
      html += `<li>${task ? `<input type="checkbox" disabled${task[1]!.toLowerCase() === "x" ? " checked" : ""}> ${inlineText(task[2]!)}` : inlineText(match[3]!)}`;
      i++;
      while (i < lines.length) {
        const next = listMatch(lines[i]!);
        if (next && next[1]!.length > indent) html += list(next[1]!.length);
        else if (!next && lines[i]!.trim() && lines[i]!.search(/\S/) > indent) html += ` ${inlineText(lines[i++]!.trim())}`;
        else break;
      }
      html += "</li>";
    }
    return html + `</${tag}>`;
  }
  const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, "|"));
  const isTable = (index: number) => lines[index]!.includes("|") && index + 1 < lines.length && cells(lines[index + 1]!).every(cell => /^:?-{3,}:?$/.test(cell));
  const output: string[] = [];
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) code.push(lines[i++]!);
      if (i < lines.length) i++;
      output.push(`<pre><code>${e(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (isTable(i)) {
      const headers = cells(line);
      i += 2;
      const rows: string[] = [];
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes("|")) {
        const row = cells(lines[i++]!);
        rows.push(`<tr>${headers.map((_, column) => `<td>${inlineText(row[column] ?? "")}</td>`).join("")}</tr>`);
      }
      output.push(`<div class="table-scroll" tabindex="0" role="region" aria-label="表格"><table><thead><tr>${headers.map(cell => `<th>${inlineText(cell)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) quote.push(lines[i++]!.replace(/^\s*> ?/, ""));
      output.push(`<blockquote>${renderMarkdown(quote.join("\n"), options)}</blockquote>`);
      continue;
    }
    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) { output.push("<hr>"); i++; continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = Math.min(6, Math.max(3, heading[1]!.length + 1));
      const id = options.headingId?.(heading[2]!, heading[1]!.length);
      output.push(`<h${level}${id ? ` id="${e(id)}" tabindex="-1"` : ""}>${inlineText(heading[2]!)}</h${level}>`);
      i++; continue;
    }
    const bullet = listMatch(line);
    if (bullet) { output.push(list(bullet[1]!.length)); continue; }
    const paragraph = [line];
    i++;
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|\s*`{3}|\s*~{3})/.test(lines[i]!) && !listMatch(lines[i]!) && !isTable(i) && !/^\s*>|^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(lines[i]!)) paragraph.push(lines[i++]!);
    output.push(`<p>${inlineText(paragraph.join("\n"))}</p>`);
  }
  return output.join("\n");
}

export function renderReadingBody(body: string, key: string, options: MarkdownOptions = {}): string {
  return `<div class="markdown-reader">
    <details class="source-toggle" data-reading-key="${e(key)}"><summary><span class="show-source">查看 Markdown 源码</span><span class="show-reading">返回阅读视图</span></summary><pre class="source-body"><code>${e(body)}</code></pre></details>
    <div class="markdown-content">${body.trim() ? renderMarkdown(body, options) : '<p class="empty-list-text">暂无正文。</p>'}</div>
  </div>`;
}
