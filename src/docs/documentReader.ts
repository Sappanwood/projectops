import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { PROJECT_DOC_TEMPLATES } from "./projectDocs.js";
import { hasLevelOneHeading } from "./projectDocsFs.js";

export type DocumentSummary = { path: string; standard: boolean; issue: string | null };
export type DocumentList = { documents: DocumentSummary[]; diagnostics: Array<{path: string; issue: string}> };
export type ProjectDocument = { path: string; body: string };
export class DocumentReadError extends Error {
  constructor(public readonly code: "DOCUMENT_NOT_FOUND" | "DOCUMENT_UNAVAILABLE" | "INVALID_DOCUMENT_PATH", message: string) { super(message); }
}

export function isDocumentPath(value: string): boolean {
  const parts = value.split("/");
  return !/[\\\x00-\x1f:]/.test(value) && parts.every(part => part !== "" && part !== "." && part !== "..")
    && (value === "README.md" || value === "AGENTS.md" || (parts[0] === "docs" && parts.length > 1 && /\.md$/i.test(value)));
}

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function projectRoot(workspace: string, project: string): string {
  const root = realpathSync(project);
  if (!within(realpathSync(workspace), root) || !lstatSync(root).isDirectory()) throw new DocumentReadError("DOCUMENT_UNAVAILABLE", "项目文档目录不可用。");
  return root;
}
function regularTarget(root: string, relative: string): string {
  let current = root;
  const parts = relative.split("/");
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !within(root, realpathSync(current)) || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) {
      throw new DocumentReadError("DOCUMENT_UNAVAILABLE", "文档不是范围内的普通文件。");
    }
  }
  return current;
}
function readError(error: unknown): DocumentReadError {
  if (error instanceof DocumentReadError) return error;
  if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return new DocumentReadError("DOCUMENT_NOT_FOUND", "文档不存在。");
  return new DocumentReadError("DOCUMENT_UNAVAILABLE", "文档无法读取。");
}

export function readProjectDocument(workspace: string, project: string, documentPath: string): ProjectDocument {
  if (!isDocumentPath(documentPath)) throw new DocumentReadError("INVALID_DOCUMENT_PATH", "仅支持 README.md、AGENTS.md 和 docs/ 下的 Markdown 文档。");
  try {
    const root = projectRoot(workspace, project);
    return {path: documentPath, body: readFileSync(regularTarget(root, documentPath), "utf8")};
  } catch (error) { throw readError(error); }
}

export function listProjectDocuments(workspace: string, project: string): DocumentList {
  const root = projectRoot(workspace, project);
  const documents: DocumentSummary[] = PROJECT_DOC_TEMPLATES.map(({path: documentPath}) => {
    try {
      const document = readProjectDocument(workspace, root, documentPath);
      return {path: documentPath, standard:true, issue:hasLevelOneHeading(document.body) ? null : "缺少一级 Markdown 标题；仍可阅读。"};
    } catch (error) { return {path: documentPath, standard:true, issue:readError(error).message}; }
  });
  const diagnostics: DocumentList["diagnostics"] = [];
  function walk(relative: string): void {
    try {
      const absolute = path.join(root, relative);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink() || !stat.isDirectory() || !within(root, realpathSync(absolute))) {
        diagnostics.push({path:relative, issue:"目录不可读取（非普通目录或符号链接）。"}); return;
      }
      for (const entry of readdirSync(absolute, {withFileTypes:true}).sort((a,b) => a.name.localeCompare(b.name))) {
        const name = `${relative}/${entry.name}`;
        if (entry.isDirectory()) walk(name);
        else if (/\.md$/i.test(entry.name) && !documents.some(d => d.path === name)) {
          documents.push({path:name, standard:false, issue:entry.isFile() ? null : "文档不是普通文件。"});
        }
      }
    } catch (error) { diagnostics.push({path:relative, issue:readError(error).message}); }
  }
  walk("docs");
  return {documents, diagnostics};
}
