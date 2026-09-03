export const VERSION = "0.0.0";

export type CliIO = {
  stdout(message: string): void;
  stderr(message: string): void;
};

const HELP = `ProjectOps

Usage: pops [options] [command]

Options:
  -h, --help     Show help
  -v, --version  Show version

Project workflows will be added as vertical slices during the alpha phase.`;

export function runCli(args: readonly string[], io: CliIO): number {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    io.stdout(HELP);
    return 0;
  }

  if (args.includes("--version") || args.includes("-v")) {
    io.stdout(VERSION);
    return 0;
  }

  io.stderr(`Unknown command: ${args.join(" ")}`);
  return 1;
}

