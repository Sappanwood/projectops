import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { devFiles, readLedger } from "./files.js";
import {
  DEV_PROTOCOL,
  DEV_TIMEOUT,
  type DevAction,
  type DevReceipt,
  recovery,
} from "./protocol.js";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export async function devRequest(
  cwd: string,
  action: DevAction,
  project = "",
): Promise<DevReceipt> {
  let files = devFiles(cwd);
  let lock = existsSync(files.lock)
    ? (JSON.parse(readFileSync(files.lock, "utf8")) as { instance: string })
    : undefined;
  const send = async () => {
    if (!lock?.instance) throw new Error("No dev manager lock");
    const expected = lock.instance;
    return new Promise<DevReceipt>((resolve, reject) => {
      const socket = createConnection(files.socket);
      let output = "";
      let settled = false;
      const fail = (error: Error) => {
        settled = true;
        socket.destroy();
        reject(error);
      };
      socket.setTimeout(DEV_TIMEOUT, () =>
        fail(new Error("Dev IPC timeout; query status before retrying mutation")),
      );
      socket.on("error", fail);
      socket.on("connect", () =>
        socket.write(
          `${JSON.stringify({ version: DEV_PROTOCOL, workspace: files.workspace, instance: expected, action, project })}\n`,
        ),
      );
      socket.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (output.length > 1024 * 1024) return fail(new Error("Dev IPC response too large"));
        if (!output.includes("\n")) return;
        try {
          const response = JSON.parse(output);
          if (
            response.version !== DEV_PROTOCOL ||
            response.workspace !== files.workspace ||
            response.instance !== expected
          )
            throw new Error(
              "Dev manager protocol/identity mismatch; inspect services before explicit manager shutdown/restart",
            );
          if (response.error) throw new Error(response.error);
          settled = true;
          socket.destroy();
          resolve(response.result as DevReceipt);
        } catch (error) {
          fail(error as Error);
        }
      });
      socket.on("close", () => {
        if (!settled) fail(new Error("Dev IPC closed without response; query status"));
      });
    });
  };
  if (lock) {
    try {
      return await send();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ECONNREFUSED") throw error;
      // A simultaneous explicit start may still be bootstrapping the lock holder.
      if (action === "start" || action === "restart") {
        const deadline = Date.now() + 2500;
        while (Date.now() < deadline) {
          await delay(50);
          try {
            return await send();
          } catch (retry) {
            if (!["ENOENT", "ECONNREFUSED"].includes((retry as NodeJS.ErrnoException).code ?? ""))
              throw retry;
          }
        }
      }
    }
  }
  const ledger = readLedger(files.ledger);
  const unknown =
    !!lock ||
    existsSync(files.socket) ||
    (!!ledger &&
      Object.values(ledger.projects).some((s) => !["stopped", "failed"].includes(s.state)));
  if (unknown)
    return {
      ok: false,
      project,
      state: "unknown",
      manager: "unknown",
      endpoints: ledger?.projects[project]?.endpoints ?? [],
      processes: ledger?.projects[project]?.processes ?? [],
      issue: recovery,
    };
  if (action !== "start" && action !== "restart")
    return {
      ok: true,
      project,
      state: "stopped",
      manager: "stopped",
      endpoints: [],
      processes: [],
      ...(action === "manager-stop" ? { affected: [] } : {}),
    };
  files = devFiles(cwd, true);
  lock = { instance: randomUUID() };
  try {
    writeFileSync(
      files.lock,
      JSON.stringify({ ...lock, workspace: files.workspace, version: DEV_PROTOCOL }),
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return devRequest(cwd, action, project);
    throw error;
  }
  const source = import.meta.url.endsWith(".ts");
  const entry = fileURLToPath(new URL(source ? "./manager.ts" : "./manager.js", import.meta.url));
  const child = spawn(
    process.execPath,
    [...(source ? ["--import", "tsx"] : []), entry, files.workspace, lock.instance],
    { detached: true, stdio: "ignore", cwd: fileURLToPath(new URL("../../", import.meta.url)) },
  );
  let spawnError: Error | undefined;
  child.on("error", (error) => {
    spawnError = error;
  });
  child.unref();
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && !spawnError) {
    await delay(50);
    try {
      return await send();
    } catch (error) {
      if (!["ENOENT", "ECONNREFUSED"].includes((error as NodeJS.ErrnoException).code ?? ""))
        throw error;
    }
  }
  if (spawnError) {
    const current = JSON.parse(readFileSync(files.lock, "utf8")) as { instance: string };
    if (current.instance === lock.instance) unlinkSync(files.lock);
  }
  throw new Error(`Dev manager bootstrap failed: ${spawnError?.message ?? recovery}`);
}
