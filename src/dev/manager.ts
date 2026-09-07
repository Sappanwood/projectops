import { chmodSync, readFileSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { devFiles, type Ledger, saveLedger } from "./files.js";
import { DEV_PROTOCOL, type DevAction, type DevReceipt } from "./protocol.js";
import { DevServiceRuntime } from "./runtime.js";

const [workspace, instance] = process.argv.slice(2);
if (!workspace || !instance || process.platform !== "linux")
  throw new Error("Dev manager requires local Linux workspace and instance");
const files = devFiles(workspace);
const lock = JSON.parse(readFileSync(files.lock, "utf8")) as {
  instance: string;
  workspace: string;
};
if (lock.instance !== instance || lock.workspace !== files.workspace)
  throw new Error("Dev manager lock identity mismatch");
const ledger: Ledger = { workspace: files.workspace, instance, pid: process.pid, projects: {} };
const runtime = new DevServiceRuntime(files.workspace, () => {
  ledger.projects = Object.fromEntries([...runtime.runs].map(([id, run]) => [id, run.status]));
  saveLedger(files, ledger);
});
let stopping: Promise<{ ok: boolean; affected: string[] }> | undefined;
async function stop() {
  stopping ??= runtime.shutdown();
  return stopping;
}
function finish(ok: boolean) {
  if (!ok) return;
  server.close();
  try {
    unlinkSync(files.socket);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if ((JSON.parse(readFileSync(files.lock, "utf8")) as { instance: string }).instance === instance)
    unlinkSync(files.lock);
}
const server = createServer((socket) => {
  let input = "";
  let accepted = false;
  socket.setTimeout(2000, () => socket.destroy());
  socket.on("error", () => {});
  socket.on("data", (chunk: Buffer) => {
    if (accepted) return socket.destroy();
    input += chunk.toString();
    if (Buffer.byteLength(input) > 4096) return socket.destroy();
    if (!input.includes("\n")) return;
    accepted = true;
    socket.setTimeout(15000, () => socket.destroy());
    void (async () => {
      let shutdown = false;
      try {
        const request = JSON.parse(input) as {
          version: number;
          workspace: string;
          instance: string;
          action: DevAction;
          project: string;
        };
        if (
          request.version !== DEV_PROTOCOL ||
          request.workspace !== files.workspace ||
          request.instance !== instance
        )
          throw new Error(
            "Dev manager protocol/identity mismatch; explicit inspection and shutdown required",
          );
        if (
          !["status", "start", "stop", "restart", "manager-stop"].includes(request.action) ||
          typeof request.project !== "string" ||
          request.project.length > 128 ||
          (request.action !== "manager-stop" && !/^[a-z0-9][a-z0-9_-]*$/.test(request.project))
        )
          throw new Error("Invalid dev action or project");
        let result: DevReceipt;
        if (request.action === "manager-stop") {
          const stopped = await stop();
          result = {
            ...runtime.status(""),
            ...stopped,
            state: stopped.ok ? "stopped" : "unknown",
            manager: stopped.ok ? "stopped" : "unknown",
          };
          shutdown = stopped.ok;
        } else if (request.action === "status") result = runtime.status(request.project);
        else result = await runtime.mutate(request.project, request.action);
        socket.end(
          `${JSON.stringify({ version: DEV_PROTOCOL, workspace: files.workspace, instance, result })}\n`,
          () => {
            if (shutdown) finish(true);
          },
        );
      } catch (error) {
        socket.end(
          `${JSON.stringify({ version: DEV_PROTOCOL, workspace: files.workspace, instance, error: String(error) })}\n`,
        );
      }
    })();
  });
});
server.listen(files.socket, () => {
  chmodSync(files.socket, 0o600);
  saveLedger(files, ledger);
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void stop().then(({ ok }) => finish(ok));
  });
