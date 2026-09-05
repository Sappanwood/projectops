import { DEFAULT_PARALLEL_COMMANDS } from '../planRun/commands.js';
import { handleParallelRunRoute } from './parallelRunRoutes.js';
import { listParallelRuns, ParallelRunRuntime } from '../application/parallelRunApi.js';
import { handlePlanRunRoute } from './planRunRoutes.js';
import { listPlanRuns, PlanRunRuntime } from '../application/planRunApi.js';
import { getExecutionEvidence } from '../application/executionEvidence.js';
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";

import {
  listBacklogItems,
  showBacklogItem,
  updateBacklogItemStatus,
  updateBacklogItemContent,
} from "../application/backlogApi.js";
import type {
  ApplicationError,
  ApplicationErrorCode,
  ApplicationResult,
} from "../application/result.js";
import {
  getWorkbenchReadPages,
  getWorkbenchProjectOverview,
  getWorkbenchWorkspaceOverview,
} from "../application/workbenchReadModel.js";
import { getWorkspaceSummary } from "../application/workspaceApi.js";
import { listDocuments, showDocument } from "../application/docsApi.js";
import { showPlanRevision, revisePlan } from "../application/planRevision.js";
import { decideExecution, listExecutions, showExecution } from "../application/executionApi.js";
import { ExecutionRuntime, type Runner } from "../execution/runtime.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7331;
const MAX_JSON_BODY_BYTES = 64 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export type WorkbenchServerStartErrorCode =
  | ApplicationErrorCode
  | "INVALID_HOST"
  | "INVALID_PORT"
  | "PORT_UNAVAILABLE"
  | "STATIC_ROOT_INVALID"
  | "START_FAILED";

export class WorkbenchServerStartError extends Error {
  constructor(
    public readonly code: WorkbenchServerStartErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type StartWorkbenchServerOptions = {
  workspaceDir: string;
  host?: string;
  port?: number;
  staticDir?: string;
  runner?: Runner;
  parallelCommands?: string[][];
};

export type WorkbenchServer = {
  readonly host: string;
  readonly port: number;
  readonly origin: string;
  readonly listening: boolean;
  close(): Promise<void>;
};

type RequestContext = {
  workspaceDir: string;
  origin: string;
  staticRoot?: string;
  runtime: ExecutionRuntime;
  planRuns: PlanRunRuntime;
  parallelRuns: ParallelRunRuntime;
  parallelCommands: string[][];
};

type HttpErrorCode =
  | "INVALID_REQUEST"
  | "METHOD_NOT_ALLOWED"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "ORIGIN_NOT_ALLOWED"
  | "INVALID_JSON"
  | "REQUEST_TOO_LARGE"
  | "ROUTE_NOT_FOUND"
  | "INTERNAL_ERROR";

class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: HttpErrorCode,
    message: string,
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export async function startWorkbenchServer(
  options: StartWorkbenchServerOptions,
): Promise<WorkbenchServer> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  validateListenOptions(host, port);

  const workspace = getWorkspaceSummary({ workspaceDir: options.workspaceDir });
  if (!workspace.ok) {
    throw new WorkbenchServerStartError(workspace.error.code, workspace.error.message);
  }
  const staticRoot = options.staticDir !== undefined
    ? resolveStaticRoot(options.staticDir)
    : resolveDefaultStaticRoot();

  let context: RequestContext | undefined;
  const server = createServer((request, response) => {
    if (context === undefined) {
      sendError(response, new HttpError(503, "INTERNAL_ERROR", "Workbench is not ready."));
      return;
    }
    void handleRequest(request, response, context).catch(() => {
      if (!response.headersSent) {
        sendError(response, new HttpError(500, "INTERNAL_ERROR", "Internal server error."));
      } else if (!response.writableEnded) {
        response.end();
      }
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1_000;

  await listen(server, host, port);
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new WorkbenchServerStartError("START_FAILED", "Workbench did not bind to a TCP port.");
  }
  const originHost = host === "::1" ? "[::1]" : host;
  const origin = `http://${originHost}:${address.port}`;
  const runtime = new ExecutionRuntime(options.runner);
  for (const project of workspace.data.projects) {
    runtime.recover({ workspaceDir: options.workspaceDir, projectId: project.id });
  }
  const planRuns = new PlanRunRuntime(runtime);
  const parallelRuns = new ParallelRunRuntime(runtime);
  const timer = setInterval(() => {
    for (const project of workspace.data.projects) {
      const q = { workspaceDir: options.workspaceDir, projectId: project.id };
      const parallel = listParallelRuns(q);
      if (parallel.ok) for (const run of parallel.data.runs) if (run.state === "running" || run.state === "paused" || (run.state === "ready" && run.controls.at(-1)?.action === "resume"))
        parallelRuns.advance({ ...q, runId: run.id, expectedRevision: run.revision });
      const listed = listPlanRuns(q);
      if (!listed.ok) continue;
      for (const run of listed.data.runs) if (run.state === "running" || run.state === "paused" || (run.state === "ready" && run.controls.at(-1)?.action === "resume"))
        planRuns.advance({ ...q, runId: run.id, expectedRevision: run.revision });
    }
  }, 1000);
  timer.unref();
  context = {
    planRuns,
    parallelRuns,
    parallelCommands: options.parallelCommands ?? DEFAULT_PARALLEL_COMMANDS,
    workspaceDir: options.workspaceDir,
    origin,
    runtime,
    ...(staticRoot === undefined ? {} : { staticRoot }),
  };

  let closing: Promise<void> | undefined;
  return {
    host,
    port: address.port,
    origin,
    get listening() {
      return server.listening;
    },
    close() {
      if (closing !== undefined) return closing;
      if (!server.listening) return Promise.resolve();
      clearInterval(timer);
      closing = closeServer(server);
      return closing;
    },
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
): Promise<void> {
  try {
    const url = parseRequestUrl(request, context.origin);
    const segments = decodePathSegments(url.pathname);

    if (matches(segments, ["api", "workspace"])) {
      requireMethod(request, "GET");
      requireNoQuery(url);
      sendApplicationResult(
        response,
        getWorkbenchWorkspaceOverview({ workspaceDir: context.workspaceDir }),
      );
      return;
    }

    if (segments.length === 3 && segments[0] === "api" && segments[1] === "projects") {
      requireMethod(request, "GET");
      requireNoQuery(url);
      sendApplicationResult(
        response,
        getWorkbenchProjectOverview({
          workspaceDir: context.workspaceDir,
          projectId: segments[2] ?? "",
        }),
      );
      return;
    }

    if (
      segments.length === 4
      && segments[0] === "api"
      && segments[1] === "projects"
      && segments[3] === "backlog"
    ) {
      requireMethod(request, "GET");
      const status = singleQueryValue(url, "status");
      sendApplicationResult(
        response,
        listBacklogItems({
          workspaceDir: context.workspaceDir,
          projectId: segments[2] ?? "",
          ...(status === undefined ? {} : { status }),
        }),
      );
      return;
    }

    if (
      segments.length === 5
      && segments[0] === "api"
      && segments[1] === "projects"
      && segments[3] === "backlog"
    ) {
      requireNoQuery(url);
      const projectId = segments[2] ?? "";
      const itemId = segments[4] ?? "";
      if (request.method === "GET") {
        sendApplicationResult(
          response,
          showBacklogItem({ workspaceDir: context.workspaceDir, projectId, itemId }),
        );
        return;
      }
      if (request.method === "PATCH") {
        requireAllowedOrigin(request, context.origin);
        requireJsonContentType(request);
        const body = await readUpdateBody(request);
        if (body.status === undefined) {
          sendApplicationResult(response, updateBacklogItemContent({
            workspaceDir: context.workspaceDir, projectId, itemId,
            ...(body.title === undefined ? {} : { title: body.title }),
            ...(body.body === undefined ? {} : { body: body.body }),
            expectedRevision: body.expected_revision!,
          }));
          return;
        }
        sendApplicationResult(
          response,
          updateBacklogItemStatus({
            workspaceDir: context.workspaceDir,
            projectId,
            itemId,
            status: body.status,
            ...(body.expected_revision === undefined
              ? {}
              : { expectedRevision: body.expected_revision }),
          }),
        );
        return;
      }
      throw new HttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed.",
        { allow: "GET, PATCH" },
      );
    }

    if (segments.length === 4 && segments[0] === "api" && segments[1] === "projects" && segments[3] === "read-pages") {
      requireMethod(request, "GET");
      requireNoQuery(url);
      sendApplicationResult(response, getWorkbenchReadPages({ workspaceDir: context.workspaceDir, projectId: segments[2]! }));
      return;
    }

    if (segments.length === 4 && segments[0] === "api" && segments[1] === "projects" && segments[3] === "docs") {
      requireMethod(request, "GET");
      const documentPath = singleQueryValue(url, "path");
      const input = {workspaceDir: context.workspaceDir, projectId: segments[2]!};
      if (documentPath === undefined) sendApplicationResult(response, listDocuments(input));
      else sendApplicationResult(response, showDocument({...input, path: documentPath}));
      return;
    }

    if (await handleParallelRunRoute(segments, request.method, context.workspaceDir, context.parallelRuns, context.parallelCommands, {
      method: expected => requireMethod(request, expected), noQuery: () => requireNoQuery(url),
      query: name => singleQueryValue(url, name),
      body: async keys => { requireAllowedOrigin(request, context.origin); requireJsonContentType(request); return readJsonRecord(request, keys); },
      send: result => sendApplicationResult(response, result),
      invalid: message => { throw new HttpError(400, "INVALID_REQUEST", message); },
    })) return;

    if (await handlePlanRunRoute(segments, request.method, context.workspaceDir, context.planRuns, {
      method: expected => requireMethod(request, expected), noQuery: () => requireNoQuery(url),
      query: name => singleQueryValue(url, name),
      body: async keys => { requireAllowedOrigin(request, context.origin); requireJsonContentType(request); return readJsonRecord(request, keys); },
      send: result => sendApplicationResult(response, result),
      invalid: message => { throw new HttpError(400, "INVALID_REQUEST", message); },
    })) return;

    if (segments[0] === "api" && segments[1] === "projects" && segments[3] === "executions") {
      const input = { workspaceDir: context.workspaceDir, projectId: segments[2]! };
      if (segments.length === 4) {
        requireMethod(request, "GET");
        const itemId = singleQueryValue(url, "item_id");
        const result = listExecutions({ ...input, ...(itemId === undefined ? {} : { itemId }) });
        sendApplicationResult(response, result.ok
          ? { ok: true, data: { ...result.data, runner_available: context.runtime.available } } : result);
        return;
      }
      if (segments.length === 6 && segments[5] === "evidence") {
        requireMethod(request, "GET");
        const ref = singleQueryValue(url, "ref");
        if (!ref) throw new HttpError(400, "INVALID_REQUEST", "An evidence reference is required.");
        sendApplicationResult(response, getExecutionEvidence({ ...input, attemptId: segments[4]!, ref }));
        return;
      }
      requireNoQuery(url);
      if (segments.length === 5 && segments[4] === "start") {
        requireMethod(request, "POST");
        requireAllowedOrigin(request, context.origin);
        requireJsonContentType(request);
        const body = await readJsonRecord(request, ["item_id", "instructions", "retry_of", "expected_revision"]);
        if (typeof body.item_id !== "string" || typeof body.expected_revision !== "string"
          || Object.values(body).some(value => typeof value !== "string")) {
          throw new HttpError(400, "INVALID_REQUEST", "Execution input is invalid.");
        }
        const task = showBacklogItem({ ...input, itemId: body.item_id });
        if (!task.ok) { sendApplicationResult(response, task); return; }
        if (task.data.item.revision !== body.expected_revision) {
          sendApplicationResult(response, { ok: false, error: { code: "REVISION_MISMATCH", message: "Task changed; reload before starting work." } });
          return;
        }
        sendApplicationResult(response, context.runtime.start({ ...input, itemId: body.item_id,
          ...(typeof body.instructions === "string" ? { instructions: body.instructions } : {}),
          ...(typeof body.retry_of === "string" ? { retryOf: body.retry_of } : {}),
        }));
        return;
      }
      if (segments.length === 5) {
        requireMethod(request, "GET");
        sendApplicationResult(response, showExecution({ ...input, attemptId: segments[4]! }));
        return;
      }
      if (segments.length === 6 && ["stop", "steer", "confirm-interrupted", "decide"].includes(segments[5]!)) {
        requireMethod(request, "POST");
        requireAllowedOrigin(request, context.origin);
        requireJsonContentType(request);
        const action = segments[5];
        const body = await readJsonRecord(request, action === "stop" ? ["expected_revision"]
          : action === "steer" ? ["expected_revision", "message"]
          : action === "decide" ? ["expected_revision", "decision", "note"] : ["expected_revision", "note"]);
        if (typeof body.expected_revision !== "string" || Object.values(body).some(value => typeof value !== "string")) {
          throw new HttpError(400, "INVALID_REQUEST", "Execution mutation is invalid.");
        }
        const mutation = { ...input, attemptId: segments[4]!, expectedRevision: body.expected_revision };
        if (action === "stop") sendApplicationResult(response, context.runtime.stop(mutation));
        else if (action === "steer") {
          if (typeof body.message !== "string" || !body.message.trim()) throw new HttpError(400, "INVALID_REQUEST", "An instruction message is required.");
          sendApplicationResult(response, await context.runtime.steer({ ...mutation, message: body.message }));
        }
        else if (action === "confirm-interrupted") sendApplicationResult(response, context.runtime.confirmInterrupted({ ...mutation, note: String(body.note ?? "") }));
        else {
          if (body.decision !== "accepted" && body.decision !== "rework") throw new HttpError(400, "INVALID_REQUEST", "Acceptance decision is invalid.");
          sendApplicationResult(response, decideExecution({ ...mutation, decision: body.decision, note: String(body.note ?? "") }));
        }
        return;
      }
    }

    if (segments[0] === "api" && segments[1] === "projects" && segments[3] === "plans") {
      requireNoQuery(url);
      const input = { workspaceDir: context.workspaceDir, projectId: segments[2]!, planId: segments[4] ?? "" };
      if (segments.length === 5) {
        requireMethod(request, "GET");
        sendApplicationResult(response, showPlanRevision(input));
        return;
      }
      if (segments.length === 6 && segments[5] === "revision") {
        requireMethod(request, "POST");
        requireAllowedOrigin(request, context.origin);
        requireJsonContentType(request);
        const body = await readJsonRecord(request, ["draft", "expected_revision", "confirm"]);
        if (typeof body.expected_revision !== "string" || !Object.hasOwn(body, "draft")
          || (body.confirm !== undefined && typeof body.confirm !== "string")) {
          throw new HttpError(400, "INVALID_REQUEST", "Revision input is invalid.");
        }
        sendApplicationResult(response, revisePlan({ ...input, draft: body.draft,
          expectedRevision: body.expected_revision,
          ...(body.confirm === undefined ? {} : { confirm: body.confirm }),
        }));
        return;
      }
    }

    if (segments[0] === "api") {
      throw new HttpError(404, "ROUTE_NOT_FOUND", "Route not found.");
    }
    requireMethod(request, "GET");
    serveStatic(response, url.pathname, context.staticRoot);
  } catch (error) {
    if (error instanceof HttpError) {
      sendError(response, error);
      return;
    }
    throw error;
  }
}

function parseRequestUrl(request: IncomingMessage, origin: string): URL {
  try {
    return new URL(request.url ?? "/", origin);
  } catch {
    throw new HttpError(400, "INVALID_REQUEST", "Request URL is invalid.");
  }
}

function decodePathSegments(pathname: string): string[] {
  try {
    return pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    throw new HttpError(400, "INVALID_REQUEST", "Request path is invalid.");
  }
}

function matches(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length
    && actual.every((segment, index) => segment === expected[index]);
}

function requireMethod(request: IncomingMessage, expected: string): void {
  if (request.method === expected) return;
  throw new HttpError(
    405,
    "METHOD_NOT_ALLOWED",
    "Method not allowed.",
    { allow: expected },
  );
}

function requireNoQuery(url: URL): void {
  if ([...url.searchParams].length === 0) return;
  throw new HttpError(400, "INVALID_REQUEST", "Query parameters are not supported.");
}

function singleQueryValue(url: URL, name: string): string | undefined {
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== name) || url.searchParams.getAll(name).length > 1) {
    throw new HttpError(400, "INVALID_REQUEST", "Query parameters are invalid.");
  }
  return url.searchParams.get(name) ?? undefined;
}

function requireAllowedOrigin(request: IncomingMessage, expectedOrigin: string): void {
  const origin = request.headers.origin;
  if (origin === undefined || origin === expectedOrigin) return;
  throw new HttpError(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed.");
}

function requireJsonContentType(request: IncomingMessage): void {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType === "application/json") return;
  throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
}

async function readUpdateBody(
  request: IncomingMessage,
): Promise<{ status?: string; title?: string; body?: string; expected_revision?: string }> {
  const record = await readJsonRecord(request, ["status", "title", "body", "expected_revision"]);
  const content = Object.hasOwn(record, "title") || Object.hasOwn(record, "body");
  if ((content && Object.hasOwn(record, "status")) || (!content && typeof record.status !== "string")
    || Object.values(record).some(value => typeof value !== "string")
    || (content && (typeof record.expected_revision !== "string" || !record.expected_revision))) {
    throw new HttpError(400, "INVALID_REQUEST", "Request body is invalid.");
  }
  return record as { status?: string; title?: string; body?: string; expected_revision?: string };
}

async function readJsonRecord(request: IncomingMessage, allowedKeys: string[]): Promise<Record<string, unknown>> {
  const raw = await readBody(request);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body is not valid JSON.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "INVALID_REQUEST", "Request body is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) {
    throw new HttpError(400, "INVALID_REQUEST", "Request body is invalid.");
  }
  return record;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    request.resume();
    throw new HttpError(413, "REQUEST_TOO_LARGE", "Request body is too large.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) {
      request.resume();
      throw new HttpError(413, "REQUEST_TOO_LARGE", "Request body is too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendApplicationResult<T>(
  response: ServerResponse,
  result: ApplicationResult<T>,
): void {
  if (result.ok) {
    sendJson(response, 200, result);
    return;
  }
  sendJson(response, statusForApplicationError(result.error), result);
}

function statusForApplicationError(error: ApplicationError): number {
  switch (error.code) {
    case "WORKSPACE_NOT_FOUND":
    case "PROJECT_NOT_FOUND":
    case "BACKLOG_STORE_NOT_FOUND":
    case "ITEM_NOT_FOUND":
    case "PLAN_NOT_FOUND":
    case "DOCUMENT_NOT_FOUND":
    case "EXECUTION_NOT_FOUND":
      return 404;
    case "REVISION_MISMATCH":
    case "EXECUTION_CONFLICT":
      return 409;
    case "WORKSPACE_INVALID":
    case "BACKLOG_STORE_INVALID":
    case "ITEM_ID_MISMATCH":
    case "ITEM_INVALID":
    case "PLAN_INVALID":
    case "DOCUMENT_UNAVAILABLE":
      return 422;
    case "INVALID_STATUS":
    case "INVALID_ITEM_ID":
    case "INVALID_DOCUMENT_PATH":
    case "EXECUTION_INVALID":
      return 400;
    case "RUNNER_UNAVAILABLE":
      return 503;
  }
}

function serveStatic(
  response: ServerResponse,
  pathname: string,
  staticRoot: string | undefined,
): void {
  if (staticRoot === undefined) {
    if (pathname !== "/") {
      throw new HttpError(404, "ROUTE_NOT_FOUND", "Route not found.");
    }
    sendText(
      response,
      200,
      "<!doctype html><html><head><meta charset=\"utf-8\"><title>ProjectOps Workbench</title></head><body><main><h1>ProjectOps Workbench</h1><p>The frontend is not built yet.</p></main></body></html>",
      "text/html; charset=utf-8",
    );
    return;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, "INVALID_REQUEST", "Request path is invalid.");
  }
  const relativePath = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const target = path.resolve(staticRoot, relativePath);
  if (!isContained(staticRoot, target) || !existsSync(target)) {
    throw new HttpError(404, "ROUTE_NOT_FOUND", "Route not found.");
  }
  const realTarget = realpathSync(target);
  if (!isContained(staticRoot, realTarget) || !statSync(realTarget).isFile()) {
    throw new HttpError(404, "ROUTE_NOT_FOUND", "Route not found.");
  }
  sendText(response, 200, readFileSync(realTarget), contentTypeFor(realTarget));
}

function sendError(response: ServerResponse, error: HttpError): void {
  sendJson(
    response,
    error.status,
    { ok: false, error: { code: error.code, message: error.message } },
    error.headers,
  );
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  sendText(
    response,
    status,
    `${JSON.stringify(body)}\n`,
    "application/json; charset=utf-8",
    headers,
  );
}

function sendText(
  response: ServerResponse,
  status: number,
  body: string | Buffer,
  contentType: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  response.end(body);
}

function contentTypeFor(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    default: return "application/octet-stream";
  }
}

function resolveStaticRoot(staticDir: string): string {
  try {
    const root = realpathSync(staticDir);
    if (!statSync(root).isDirectory()) throw new Error("not a directory");
    return root;
  } catch {
    throw new WorkbenchServerStartError(
      "STATIC_ROOT_INVALID",
      "Workbench static root is invalid.",
    );
  }
}

function resolveDefaultStaticRoot(): string | undefined {
  const candidates = [
    path.resolve(import.meta.dirname, "../../dist/web"),
    path.resolve(import.meta.dirname, "../web"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const root = realpathSync(candidate);
        const indexHtml = path.join(root, "index.html");
        const appJs = path.join(root, "app.js");
        if (
          statSync(root).isDirectory()
          && existsSync(indexHtml)
          && statSync(indexHtml).isFile()
          && existsSync(appJs)
          && statSync(appJs).isFile()
        ) {
          return root;
        }
      } catch {
        // Fall back when unreadable or invalid
      }
    }
  }
  return undefined;
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function validateListenOptions(host: string, port: number): void {
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new WorkbenchServerStartError(
      "INVALID_HOST",
      "Workbench host must be a loopback address.",
    );
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new WorkbenchServerStartError(
      "INVALID_PORT",
      "Workbench port must be an integer between 0 and 65535.",
    );
  }
}

function listen(
  server: ReturnType<typeof createServer>,
  host: string,
  port: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off("listening", onListening);
      if (error.code === "EADDRINUSE") {
        reject(new WorkbenchServerStartError(
          "PORT_UNAVAILABLE",
          `Port ${port} is unavailable on ${host}.`,
        ));
        return;
      }
      reject(new WorkbenchServerStartError("START_FAILED", "Workbench server could not start."));
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host, port, exclusive: true });
  });
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    const forceTimer = setTimeout(() => server.closeAllConnections(), 1_000);
    forceTimer.unref();
    server.close((error) => {
      clearTimeout(forceTimer);
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
