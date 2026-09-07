import type { DevEndpoint } from "../application/devApi.js";
export const DEV_PROTOCOL = 1;
export const DEV_TIMEOUT = 15000;
export type DevAction = "status" | "start" | "stop" | "restart" | "manager-stop";
export type DevStatus = {
  ok: boolean;
  project: string;
  state: "stopped" | "starting" | "running" | "stopping" | "failed" | "unknown";
  manager: "running" | "stopped" | "unknown";
  instance?: string;
  endpoints: DevEndpoint[];
  processes: { name: string; pid?: number; state: string; log: string }[];
  issue?: string;
};
export type DevReceipt = DevStatus & { affected?: string[] };
export const recovery =
  "Manager ownership unknown. Inspect ledger.json and verify all recorded process groups manually; do not kill by stale PID. After confirming all old processes stopped, remove only socket, lock.json and ledger.json under this workspace .pops/runtime/dev, then explicitly start.";
