import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { findWorkspaceRoot, WorkspaceNotFoundError } from "../catalog/workspaceStore.js";
import type { DevStatus } from "./protocol.js";
export type Ledger = {
  workspace: string;
  instance: string;
  pid: number;
  projects: Record<string, DevStatus>;
};
export function devFiles(cwd: string, create = false) {
  const root = findWorkspaceRoot(cwd);
  if (root === null) throw new WorkspaceNotFoundError(cwd);
  const workspace = realpathSync(root);
  const dir = path.join(workspace, ".pops/runtime/dev");
  for (const relative of [".pops", ".pops/runtime", ".pops/runtime/dev"]) {
    const target = path.join(workspace, relative);
    if (existsSync(target)) {
      if (lstatSync(target).isSymbolicLink() || !lstatSync(target).isDirectory())
        throw new Error(`Unsafe dev runtime directory: ${target}`);
    } else if (create) {
      try {
        mkdirSync(target, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      if (lstatSync(target).isSymbolicLink() || !lstatSync(target).isDirectory())
        throw new Error(`Unsafe dev runtime directory: ${target}`);
    }
  }
  const socket = path.join(dir, "socket");
  if (Buffer.byteLength(socket) > 103)
    throw new Error("Dev IPC socket path too long; use a shorter canonical workspace path");
  for (const name of ["socket", "lock.json", "ledger.json", "ledger.next"]) {
    const target = path.join(dir, name);
    try {
      if (lstatSync(target).isSymbolicLink())
        throw new Error(`Unsafe dev runtime symlink: ${target}`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  return {
    workspace,
    dir,
    socket,
    lock: path.join(dir, "lock.json"),
    ledger: path.join(dir, "ledger.json"),
  };
}
export function readLedger(file: string): Ledger | undefined {
  if (!existsSync(file)) return;
  if (lstatSync(file).size > 1024 * 1024) throw new Error("Dev ledger exceeds size limit");
  return JSON.parse(readFileSync(file, "utf8")) as Ledger;
}
export function saveLedger(files: ReturnType<typeof devFiles>, ledger: Ledger) {
  devFiles(files.workspace);
  const next = path.join(files.dir, "ledger.next");
  writeFileSync(next, JSON.stringify(ledger), { flag: "wx", mode: 0o600 });
  renameSync(next, files.ledger);
}
