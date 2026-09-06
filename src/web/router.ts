import { isValidView, type RouteState, type ViewType } from "./types.js";

export function parseRoute(rawHash: string): RouteState {
  const hash = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
  const path = hash.split("?")[0]?.trim() ?? "";

  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) {
    return { projectId: null, view: "overview" };
  }

  if (segments[0] === "projects" && segments[1] !== undefined) {
    let projectId: string;
    try {
      projectId = decodeURIComponent(segments[1]);
    } catch {
      projectId = segments[1];
    }
    const rawView = segments[2] ?? "overview";
    const view: ViewType = isValidView(rawView) ? rawView : "overview";
    const decode = (value: string) => {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    };
    const detail = segments[3] ? decode(segments[3]) : undefined;
    const params = new URLSearchParams(hash.split("?")[1] ?? "");
    const plan = params.get("plan");
    const from = params.get("from");
    return {
      projectId,
      view,
      ...(from && isReturnRoute(from) ? { returnTo: from } : {}),
      ...(view === "retrospectives" && detail ? { retrospectiveId: detail } : {}),
      ...(view === "retrospectives" &&
      ["filter_project", "status", "task"].some((key) => params.has(key))
        ? {
            retrospectiveFilters: {
              project: params.get("filter_project") ?? projectId,
              status: params.get("status") ?? "",
              task: params.get("task") ?? "",
            },
          }
        : {}),
      ...((view === "docs" || view === "research") && params.has("path")
        ? { documentPath: params.get("path")! }
        : {}),
      ...((view === "docs" || view === "research") && params.has("section")
        ? { section: params.get("section")! }
        : {}),
      ...(view === "plans" && detail ? { planId: detail } : {}),
      ...(view === "backlog" && detail ? { itemId: detail } : {}),
      ...(view === "reports" && detail ? { reportId: detail } : {}),
      ...((view === "backlog" || view === "reports") && plan ? { planId: plan } : {}),
    };
  }

  return { projectId: null, view: "overview" };
}

export function formatRoute(route: RouteState): string {
  const base = formatBaseRoute(route);
  return route.returnTo && isReturnRoute(route.returnTo)
    ? `${base}${base.includes("?") ? "&" : "?"}from=${encodeURIComponent(route.returnTo)}`
    : base;
}

function isReturnRoute(value: string): boolean {
  return (
    value.length < 8192 &&
    !/[\x00-\x1f]/.test(value) &&
    (/^#\/projects\/[^/?#]+(?:\/overview)?$/.test(value) ||
      /^#\/projects\/[^/?#]+\/(backlog|plans|reports|docs|retrospectives)(?:[/?]|$)/.test(value))
  );
}

function formatBaseRoute(route: RouteState): string {
  if (route.projectId === null || route.projectId.trim() === "") {
    return "#/";
  }
  const encodedId = encodeURIComponent(route.projectId);
  if (route.view === "overview") {
    return `#/projects/${encodedId}`;
  }
  const base = `#/projects/${encodedId}/${route.view}`;
  if (route.view === "retrospectives") {
    const filters = route.retrospectiveFilters;
    const params = filters
      ? new URLSearchParams({
          filter_project: filters.project,
          status: filters.status,
          task: filters.task,
        })
      : null;
    return `${base}${route.retrospectiveId ? `/${encodeURIComponent(route.retrospectiveId)}` : ""}${params ? `?${params}` : ""}`;
  }
  if (route.view === "docs" || route.view === "research") {
    const params = new URLSearchParams();
    if (route.documentPath !== undefined) params.set("path", route.documentPath);
    if (route.section !== undefined) params.set("section", route.section);
    return base + (params.size ? `?${params}` : "");
  }
  if (route.view === "plans" && route.planId) return `${base}/${encodeURIComponent(route.planId)}`;
  if (route.view === "backlog")
    return `${base}${route.itemId ? `/${encodeURIComponent(route.itemId)}` : ""}${route.planId ? `?plan=${encodeURIComponent(route.planId)}` : ""}`;
  if (route.view === "reports")
    return `${base}${route.reportId ? `/${encodeURIComponent(route.reportId)}` : ""}${route.planId ? `?plan=${encodeURIComponent(route.planId)}` : ""}`;
  return base;
}

export type Router = {
  getCurrentRoute(): RouteState;
  navigate(route: RouteState): void;
  cleanup(): void;
};

export function setupRouter(onChange: (route: RouteState) => void): Router {
  const handleHashChange = (): void => {
    const route = parseRoute(window.location.hash);
    onChange(route);
  };

  window.addEventListener("hashchange", handleHashChange);

  return {
    getCurrentRoute() {
      return parseRoute(window.location.hash);
    },
    navigate(route: RouteState) {
      const nextHash = formatRoute(route);
      if (window.location.hash !== nextHash) {
        window.location.hash = nextHash;
      } else {
        // If hash didn't change, still notify listener so state updates
        onChange(route);
      }
    },
    cleanup() {
      window.removeEventListener("hashchange", handleHashChange);
    },
  };
}
