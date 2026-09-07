export type DevDescriptor = {
  host: string;
  endpoints: Record<string, { port: number }>;
  processes: Record<string, { command: string[]; cwd: string; env: Record<string, string> }>;
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const name = /^[a-z][a-z0-9_]*$/;
export function devVariables(dev: DevDescriptor): Record<string, string> {
  const values: Record<string, string> = { HOST: dev.host };
  for (const [id, endpoint] of Object.entries(dev.endpoints)) {
    values[`${id.toUpperCase()}_PORT`] = String(endpoint.port);
    values[`${id.toUpperCase()}_ORIGIN`] =
      `http://${dev.host === "::1" ? "[::1]" : dev.host}:${endpoint.port}`;
  }
  return values;
}
export function expandDevValue(value: string, variables: Record<string, string>): string {
  return value.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_, key: string) => variables[key]!);
}
export function validateDevDescriptor(value: unknown): string | null {
  if (
    !record(value) ||
    typeof value.host !== "string" ||
    !["127.0.0.1", "::1"].includes(value.host)
  )
    return "dev host must be 127.0.0.1 or ::1";
  if (!record(value.endpoints) || Object.keys(value.endpoints).length === 0)
    return "dev endpoints must be a non-empty object";
  for (const [id, endpoint] of Object.entries(value.endpoints)) {
    if (
      !name.test(id) ||
      !record(endpoint) ||
      !Number.isInteger(endpoint.port) ||
      Number(endpoint.port) < 1 ||
      Number(endpoint.port) > 65535
    )
      return `invalid dev endpoint/port: ${id}`;
  }
  if (!record(value.processes) || Object.keys(value.processes).length === 0)
    return "dev processes must be a non-empty object";
  const variables = devVariables(value as DevDescriptor);
  for (const [id, process] of Object.entries(value.processes)) {
    if (!name.test(id) || !record(process)) return `invalid dev process: ${id}`;
    if (
      !Array.isArray(process.command) ||
      process.command.length === 0 ||
      process.command.some((arg) => typeof arg !== "string" || arg.includes("\0")) ||
      !(process.command[0] as string).trim()
    )
      return `invalid dev command: ${id}`;
    if (
      typeof process.cwd !== "string" ||
      !(
        process.cwd === "." ||
        process.cwd.split("/").every((part) => part !== "" && part !== "." && part !== "..")
      ) ||
      process.cwd.includes("\\") ||
      process.cwd.includes("\0")
    )
      return `invalid dev cwd: ${id}`;
    if (
      !record(process.env) ||
      Object.entries(process.env).some(
        ([key, v]) =>
          !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
          key in variables ||
          typeof v !== "string" ||
          v.includes("\0"),
      )
    )
      return `invalid dev env: ${id}`;
    for (const input of [...process.command, ...Object.values(process.env)] as string[]) {
      const rest = input.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (match, key: string) =>
        key in variables ? "" : match,
      );
      if (rest.includes("$")) return `unknown dev substitution variable: ${id}`;
    }
  }
  return null;
}
