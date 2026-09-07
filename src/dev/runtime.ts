import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { checkDevProject, type ResolvedDevProject } from "../application/devApi.js";
import type { DevStatus } from "./protocol.js";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export async function reachable(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(200, () => finish(false));
    socket.on("error", () => finish(false));
    socket.on("connect", () => finish(true));
  });
}
function groupAlive(pgid: number) {
  // Linux procfs distinguishes unreaped zombies from running descendants.
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (Number(fields[2]) === pgid && fields[0] !== "Z") return true;
    } catch (error) {
      if (!["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  }
  return false;
}
type Run = { status: DevStatus; config: ResolvedDevProject | null; children: ChildProcess[] };
export class DevServiceRuntime {
  readonly runs = new Map<string, Run>();
  private readonly queues = new Map<string, Promise<unknown>>();
  closing = false;
  constructor(
    readonly workspace: string,
    readonly changed: () => void,
  ) {}
  status(project: string): DevStatus {
    return (
      this.runs.get(project)?.status ?? {
        ok: true,
        project,
        state: "stopped",
        manager: "running",
        endpoints: [],
        processes: [],
      }
    );
  }
  async mutate(
    project: string,
    action: "start" | "stop" | "restart",
    expectedRun?: Run,
  ): Promise<DevStatus> {
    const prior = this.queues.get(project) ?? Promise.resolve();
    const job = prior
      .catch(() => {})
      .then(async () => {
        if (expectedRun && this.runs.get(project) !== expectedRun) return expectedRun.status;
        if (this.closing && action !== "stop") throw new Error("Dev manager is stopping");
        if (action === "stop") return this.stop(project);
        if (action === "restart") {
          const stopped = await this.stop(project);
          if (!stopped.ok) return stopped;
        }
        return this.start(project);
      });
    this.queues.set(project, job);
    try {
      return await job;
    } finally {
      if (this.queues.get(project) === job) this.queues.delete(project);
    }
  }
  private async start(project: string) {
    const current = this.runs.get(project);
    if (current?.status.state === "running") return current.status;
    if (current?.status.state === "unknown") return current.status;
    const check = await checkDevProject(this.workspace, project);
    if (this.closing) throw new Error("Dev manager is stopping");
    if (!check.ok || !check.configuration) {
      const status: DevStatus = {
        ...this.status(project),
        ok: false,
        state: "failed",
        issue: check.problems.map((p) => p.issue).join("; "),
      };
      this.runs.set(project, { config: check.configuration, children: [], status });
      this.changed();
      return status;
    }
    const run: Run = {
      config: check.configuration,
      children: [],
      status: {
        ok: true,
        project,
        state: "starting",
        manager: "running",
        instance: randomUUID(),
        endpoints: check.configuration.endpoints,
        processes: [],
      },
    };
    this.runs.set(project, run);
    this.changed();
    let failure = "";
    for (const spec of check.configuration.processes) {
      const summary: DevStatus["processes"][number] = {
        name: spec.name,
        state: "starting",
        log: "",
      };
      run.status.processes.push(summary);
      const child = spawn(spec.command[0]!, spec.command.slice(1), {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      run.children.push(child);
      if (child.pid) summary.pid = child.pid;
      for (const stream of [child.stdout, child.stderr])
        stream?.on("data", (data: Buffer) => {
          let chunk = data.toString();
          for (const value of Object.values(spec.env))
            if (value) chunk = chunk.split(value).join("[redacted]");
          summary.log = (summary.log + chunk).slice(-4096);
        });
      child.on("error", (error) => {
        failure = `${spec.name}: ${error.message}`;
        summary.state = "failed";
      });
      child.on("exit", (code, signal) => {
        if (summary.state !== "stopped") summary.state = "exited";
        failure = `${spec.name} exited (${code ?? signal})`;
        if (run.status.state === "running")
          void this.mutate(project, "stop", run).then((status) => {
            if (this.runs.get(project) !== run) return;
            if (status.state !== "unknown") status.state = "failed";
            status.ok = false;
            status.issue = failure;
            this.changed();
          });
      });
      this.changed();
    }
    const deadline = Date.now() + 8000;
    while (!failure && Date.now() < deadline) {
      const ready = await Promise.all(
        (run.config?.endpoints ?? []).map((e) => reachable(e.host, e.port)),
      );
      if (
        ready.every(Boolean) &&
        !failure &&
        run.children.every((c) => c.pid && c.exitCode === null && c.signalCode === null)
      ) {
        run.status.state = "running";
        for (const summary of run.status.processes) summary.state = "running";
        this.changed();
        return run.status;
      }
      await delay(50);
    }
    const stopped = await this.stop(project);
    if (stopped.state !== "unknown") stopped.state = "failed";
    stopped.ok = false;
    stopped.issue = failure || "Development endpoint readiness timed out";
    this.changed();
    return stopped;
  }
  private async stop(project: string) {
    const run = this.runs.get(project);
    if (!run) return this.status(project);
    if (run.status.state === "unknown") return run.status;
    run.status.state = "stopping";
    this.changed();
    const pids = run.children.flatMap((child) => (child.pid ? [child.pid] : []));
    const signal = (kind: NodeJS.Signals) => {
      for (const pid of pids)
        try {
          process.kill(-pid, kind);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
    };
    try {
      signal("SIGTERM");
      let deadline = Date.now() + 1000;
      while (pids.some(groupAlive) && Date.now() < deadline) await delay(30);
      if (pids.some(groupAlive)) signal("SIGKILL");
      deadline = Date.now() + 1000;
      while (pids.some(groupAlive) && Date.now() < deadline) await delay(30);
      if (pids.some(groupAlive)) throw new Error("Owned process group did not stop");
      if (
        pids.length &&
        (
          await Promise.all((run.config?.endpoints ?? []).map((e) => reachable(e.host, e.port)))
        ).some(Boolean)
      )
        throw new Error(
          "Endpoint still occupied after owned groups stopped; external listener was not killed",
        );
      run.status.state = "stopped";
      run.status.ok = true;
      run.children = [];
      for (const summary of run.status.processes) summary.state = "stopped";
    } catch (error) {
      run.status.state = "unknown";
      run.status.ok = false;
      run.status.issue = String(error);
    }
    this.changed();
    return run.status;
  }
  async shutdown() {
    this.closing = true;
    await Promise.allSettled([...this.queues.values()]);
    const affected = [...this.runs.keys()];
    const results = await Promise.all(affected.map((id) => this.mutate(id, "stop")));
    return { affected, ok: results.every((r) => r.ok) };
  }
}
