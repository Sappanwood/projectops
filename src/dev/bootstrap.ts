import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { loadWorkspace } from "../catalog/workspaceStore.js";
import { devFiles, readLedger } from "./files.js";
import { DEV_PROTOCOL } from "./protocol.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type DevLock = {
  instance: string;
  workspace: string;
  version: number;
  boot_id?: string;
};
export function currentBootId(): string | undefined {
  try {
    const value = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    return uuid.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
function readLock(file: string): DevLock | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as DevLock;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function prepareDevRequest(cwd: string, starting: boolean) {
  let files = devFiles(cwd);
  if (process.platform !== "linux") throw new Error("Dev manager requires local Linux workspace");
  // An abstract socket serializes recovery and lock publication without crash residue.
  const address = `\0pops-dev-bootstrap-${createHash("sha256").update(files.workspace).digest("hex")}`;
  const deadline = Date.now() + 3000;
  let guard;
  for (;;) {
    const candidate = createServer((socket) => socket.destroy());
    try {
      await new Promise<void>((resolve, reject) => {
        candidate.once("error", reject);
        candidate.listen(address, resolve);
      });
      guard = candidate;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      if (Date.now() >= deadline)
        throw new Error("Dev bootstrap busy; retry after querying status");
      await delay(50);
    }
  }
  try {
    files = devFiles(cwd);
    let lock = readLock(files.lock);
    let ledger = readLedger(files.ledger);
    const boot = currentBootId();
    const records = [lock, ledger].filter((record) => record !== undefined);
    const oldBoot = records[0]?.boot_id;
    const previousBoot = !!(
      boot &&
      oldBoot &&
      uuid.test(oldBoot) &&
      oldBoot !== boot &&
      records.every(
        (record) =>
          record.boot_id === oldBoot &&
          record.workspace === files.workspace &&
          typeof record.instance === "string" &&
          record.instance.length > 0 &&
          record.instance === records[0]!.instance,
      ) &&
      (!lock || lock.version === DEV_PROTOCOL)
    );
    let recovered: string | undefined;
    if (starting && previousBoot) {
      loadWorkspace(files.workspace);
      // Keep the boot evidence until the other fixed runtime files have been removed.
      for (const file of [files.socket, files.next, files.ledger, files.lock]) {
        try {
          unlinkSync(file);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      lock = undefined;
      ledger = undefined;
      recovered = oldBoot;
    }
    const unknown =
      !!lock ||
      existsSync(files.socket) ||
      existsSync(files.next) ||
      (!!ledger &&
        Object.values(ledger.projects).some((s) => !["stopped", "failed"].includes(s.state)));
    let created = false;
    if (starting && !unknown) {
      loadWorkspace(files.workspace);
      if (!boot) throw new Error("Cannot read Linux boot_id; dev manager was not started");
      files = devFiles(cwd, true);
      lock = {
        instance: randomUUID(),
        workspace: files.workspace,
        version: DEV_PROTOCOL,
        boot_id: boot,
      };
      writeFileSync(files.lock, JSON.stringify(lock), { flag: "wx", mode: 0o600 });
      created = true;
    }
    return { files, lock, ledger, unknown, previousBoot, recovered, created };
  } finally {
    await new Promise<void>((resolve, reject) =>
      guard.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
