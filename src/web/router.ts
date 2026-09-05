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
    return { projectId, view };
  }

  return { projectId: null, view: "overview" };
}

export function formatRoute(route: RouteState): string {
  if (route.projectId === null || route.projectId.trim() === "") {
    return "#/";
  }
  const encodedId = encodeURIComponent(route.projectId);
  if (route.view === "overview") {
    return `#/projects/${encodedId}`;
  }
  return `#/projects/${encodedId}/${route.view}`;
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
