import type { WorkbenchReadPages } from "../application/workbenchReadModel.js";
import type { AppError, WorkbenchProjectOverview, WorkbenchWorkspaceOverview } from "./types.js";
import type { BacklogItem } from "../backlog/item.js";
import type { BacklogItemSummary, BacklogMutationReceipt } from "../application/backlogApi.js";
import type { DocumentList, ProjectDocument } from "../docs/documentReader.js";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

export type ApiClient = {
  request?<T>(path: string, body?: unknown, method?: string): Promise<ApiResult<T>>;
  listDocuments(projectId: string): Promise<ApiResult<DocumentList>>;
  showDocument(projectId: string, path: string): Promise<ApiResult<ProjectDocument>>;
  getReadPages(projectId: string): Promise<ApiResult<WorkbenchReadPages>>;
  getWorkspaceOverview(): Promise<ApiResult<WorkbenchWorkspaceOverview>>;
  getProjectOverview(projectId: string): Promise<ApiResult<WorkbenchProjectOverview>>;
  listBacklog(projectId: string): Promise<ApiResult<{ items: BacklogItemSummary[] }>>;
  showBacklog(projectId: string, itemId: string): Promise<ApiResult<{ item: BacklogItem }>>;
  updateBacklog(
    projectId: string,
    itemId: string,
    status: string,
    revision: string,
  ): Promise<ApiResult<BacklogMutationReceipt>>;
};

export type FetchFunction = typeof fetch;

export function createApiClient(
  options: { baseUrl?: string; fetchFn?: FetchFunction } = {},
): ApiClient {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");

  async function request<T>(path: string, body?: unknown, method?: string): Promise<ApiResult<T>> {
    const url = `${baseUrl}${path}`;
    try {
      const response = await fetchFn(url, {
        method: method ?? (body === undefined ? "GET" : "PATCH"),
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      const text = await response.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        return {
          ok: false,
          error: {
            code: "INVALID_RESPONSE",
            message: `Server returned non-JSON response (${response.status}).`,
          },
        };
      }

      if (payload !== null && typeof payload === "object" && "ok" in payload) {
        return payload as ApiResult<T>;
      }

      return {
        ok: false,
        error: {
          code: "INVALID_RESPONSE",
          message: "Unexpected server response envelope.",
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network request failed.";
      return {
        ok: false,
        error: {
          code: "NETWORK_ERROR",
          message,
        },
      };
    }
  }

  return {
    request,
    listDocuments(projectId) {
      return request(`/api/projects/${encodeURIComponent(projectId)}/docs`);
    },
    showDocument(projectId, path) {
      return request(
        `/api/projects/${encodeURIComponent(projectId)}/docs?path=${encodeURIComponent(path)}`,
      );
    },
    getReadPages(projectId) {
      return request(`/api/projects/${encodeURIComponent(projectId)}/read-pages`);
    },
    getWorkspaceOverview() {
      return request<WorkbenchWorkspaceOverview>("/api/workspace");
    },
    getProjectOverview(projectId: string) {
      return request<WorkbenchProjectOverview>(`/api/projects/${encodeURIComponent(projectId)}`);
    },
    listBacklog(projectId) {
      return request(`/api/projects/${encodeURIComponent(projectId)}/backlog`);
    },
    showBacklog(projectId, itemId) {
      return request(
        `/api/projects/${encodeURIComponent(projectId)}/backlog/${encodeURIComponent(itemId)}`,
      );
    },
    updateBacklog(projectId, itemId, status, revision) {
      return request(
        `/api/projects/${encodeURIComponent(projectId)}/backlog/${encodeURIComponent(itemId)}`,
        {
          status,
          expected_revision: revision,
        },
      );
    },
  };
}
