import type { Plan } from "../plan/plan.js";

export function mappingTarget(owner: string, value: string) {
  const [first, second] = value.split(":");
  return { project: second ? first! : owner, id: second ?? first! };
}

export function planRunRestriction(plan: Plan | undefined, owner: string): string {
  if (plan?.materialization?.state === "partial")
    return "部分物化尚未完成，请先通过 CLI 核对并恢复物化。自动运行不可用。";
  if (
    Object.values(plan?.materialization?.mapping ?? {}).some(
      (value) => mappingTarget(owner, value).project !== owner,
    )
  )
    return "跨项目 Plan 不支持自动运行，请在各项目分别执行任务。";
  return "";
}
