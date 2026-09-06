import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import type { SettingsManager as PiSettingsManager } from "@earendil-works/pi-coding-agent";
import { skillStatus, SKILL_TARGET } from "../skills/skillInstall.js";
import type { ExecutionAttempt } from "./attempt.js";
import type { Runner, RunnerResult } from "./runtime.js";
import { createPiModelRuntime, listPiModels, resolvePiModel } from "./piModels.js";

export type PiSession = {
  sessionId: string;
  model?: { provider: string; id: string } | undefined;
  messages: unknown[];
  subscribe(listener: (event: unknown) => void): () => void;
  prompt(text: string): Promise<void>;
  steer(text: string): Promise<void>;
  clearQueue(): unknown;
  abort(): Promise<void>;
  dispose(): void;
};
type StartContext = Parameters<Runner["start"]>[1];
type SessionFactory = (attempt: ExecutionAttempt, context: StartContext) => Promise<PiSession>;
class PiConfigurationError extends Error {}

export function createPiRunner(factory: SessionFactory = openPiSession): Runner {
  return {
    listModels: listPiModels,
    resolveModel: resolvePiModel,
    start(attempt, context) {
      let stopped = false;
      let session: PiSession | undefined;
      let unsubscribe: (() => void) | undefined;
      const ready = factory(attempt, context);
      const completion = (async (): Promise<RunnerResult> => {
        try {
          session = await ready;
          if (session.model)
            context.recordModel?.({ provider: session.model.provider, id: session.model.id });
          context.emit({ type: "session", text: session.sessionId });
          context.emit({
            type: "status",
            text: `Pi 0.85.0 · ${session.model?.provider ?? "unknown"}/${session.model?.id ?? "unknown"}`,
          });
          unsubscribe = session.subscribe((raw) => {
            const event = raw as {
              type?: string;
              toolName?: string;
              assistantMessageEvent?: { type: string; delta?: string };
            };
            if (
              event.type === "message_update" &&
              event.assistantMessageEvent?.type === "text_delta"
            )
              context.emit({ type: "text", text: event.assistantMessageEvent.delta ?? "" });
            if (event.type === "tool_execution_start" || event.type === "tool_execution_end")
              context.emit({
                type: "tool",
                text: `${event.toolName ?? "tool"}: ${event.type === "tool_execution_start" ? "开始" : "结束"}`,
              });
          });
          if (stopped) return { outcome: "stopped", summary: "Pi 已在开始前停止。" };
          await session.prompt(
            `完成以下 ProjectOps 任务。遵守已加载的 AGENTS.md 与任务边界。不要修改任务状态、执行记录或自行验收，不提交或发布 Git 改动。不要读取、输出或写入凭据。结束时说明改动和实际验证结果。\n\n${attempt.input.item.id}: ${attempt.input.item.title}\n\n${attempt.input.item.body}\n\n补充指示：\n${attempt.input.instructions}`,
          );
          const last = [...session.messages]
            .reverse()
            .find((m) => (m as { role?: string }).role === "assistant") as
            | { stopReason?: string; content?: { type: string; text?: string }[] }
            | undefined;
          if (stopped || last?.stopReason === "aborted")
            return { outcome: "stopped", summary: "Pi 已确认停止。" };
          if (last?.stopReason !== "stop")
            return {
              outcome: "failed",
              summary: "Pi 未正常完成响应（错误、截断或结果缺失），请检查后重试。",
            };
          const summary = last?.content
            ?.filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("\n");
          return {
            outcome: "succeeded",
            summary: summary || "Pi 工作结束，仍需记录验证并显式验收。",
          };
        } catch (error) {
          return {
            outcome: stopped ? "stopped" : "failed",
            summary: stopped
              ? "Pi 已停止。"
              : error instanceof PiConfigurationError
                ? error.message
                : "Pi 启动或工作失败，请检查服务端模型、凭据和连接配置后重试。",
          };
        } finally {
          unsubscribe?.();
          session?.dispose();
        }
      })();
      return {
        completion,
        async steer(message) {
          const current = await ready;
          if (stopped) throw Error("Pi is stopping.");
          await current.steer(message);
        },
        async stop() {
          stopped = true;
          const current = await ready;
          current.clearQueue();
          await current.abort();
        },
      };
    },
  };
}

async function openPiSession(attempt: ExecutionAttempt, context: StartContext): Promise<PiSession> {
  const { createAgentSession, getAgentDir, SessionManager, SettingsManager } = await import(
    "@earendil-works/pi-coding-agent"
  );
  let sessionDir = realpathSync(context.workspaceDir);
  for (const segment of [".pops", "runtime", "pi", attempt.id]) {
    sessionDir = path.join(sessionDir, segment);
    try {
      mkdirSync(sessionDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (!lstatSync(sessionDir).isDirectory() || lstatSync(sessionDir).isSymbolicLink())
      throw Error("Invalid Pi session directory.");
  }
  const agentDir = getAgentDir();
  const modelRuntime = await createPiModelRuntime();
  const selected = attempt.input.model;
  const model = selected
    ? (await modelRuntime.getAvailable()).find(
        (m) => m.provider === selected.provider && m.id === selected.id,
      )
    : undefined;
  if (selected && !model)
    throw new PiConfigurationError("所选模型不可用，请在本地 Pi 完成认证后重试。");
  const settingsManager = SettingsManager.create(context.repo, agentDir);
  if (settingsManager.drainErrors().length)
    throw new PiConfigurationError("Pi 配置读取失败，请检查服务端配置文件与临时锁权限。");
  const loader = await createPiResourceLoader(
    context.workspaceDir,
    context.repo,
    agentDir,
    settingsManager,
  );
  context.emit({
    type: "status",
    text: `已加载 instructions: ${loader
      .getAgentsFiles()
      .agentsFiles.map((f) => f.path)
      .join(", ")}；skills: ${loader
      .getSkills()
      .skills.map((s) => `${s.name} (${s.filePath})`)
      .join(", ")}；tools: read, bash, edit, write；extensions 已禁用。`,
  });
  const { session } = await createAgentSession({
    cwd: context.repo,
    agentDir,
    settingsManager,
    resourceLoader: loader,
    modelRuntime,
    ...(model ? { model } : {}),
    tools: ["read", "bash", "edit", "write"],
    sessionManager: SessionManager.create(context.repo, sessionDir),
  });
  return session;
}

export async function createPiResourceLoader(
  workspaceDir: string,
  cwd: string,
  agentDir: string,
  settingsManager: PiSettingsManager,
) {
  const { DefaultResourceLoader, loadSkills } = await import("@earendil-works/pi-coding-agent");
  let status: ReturnType<typeof skillStatus>;
  try {
    status = skillStatus(workspaceDir);
  } catch {
    throw new PiConfigurationError(
      "Workspace skill 检查失败；运行 pops skill status --json 检查安装路径和分发文件。",
    );
  }
  if (status.status !== "missing" && !status.matches_cli)
    throw new PiConfigurationError(
      "Workspace ProjectOps skill 与当前 CLI 不匹配或已修改；先运行 pops skill status --json 并按诊断恢复。",
    );
  const installed = status.matches_cli
    ? loadSkills({
        cwd,
        agentDir,
        includeDefaults: false,
        skillPaths: [path.join(workspaceDir, SKILL_TARGET, "SKILL.md")],
      })
    : null;
  if (installed && (installed.skills.length !== 1 || installed.diagnostics.length))
    throw new PiConfigurationError(
      "Workspace ProjectOps skill 无法加载；运行 pops skill status --json 检查安装。",
    );
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    ...(installed
      ? {
          skillsOverride: (base: ReturnType<typeof loadSkills>) => ({
            skills: [
              ...base.skills.filter((skill) => skill.name !== "projectops-workflow"),
              ...installed.skills,
            ],
            diagnostics: base.diagnostics.filter(
              (diagnostic) => diagnostic.collision?.name !== "projectops-workflow",
            ),
          }),
        }
      : {}),
  });
  await loader.reload();
  return loader;
}
