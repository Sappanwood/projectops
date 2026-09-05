#!/usr/bin/env node

import { parseArgs } from "node:util";
import { createPiRunner } from './execution/piRunner.js';

import {
  WorkbenchServerStartError,
  startWorkbenchServer,
  type StartWorkbenchServerOptions,
} from "./server/workbenchServer.js";

const HELP = `ProjectOps Workbench

Usage: npm run workbench -- --workspace <path> [options]

Options:
  --workspace <path>  Explicit workspace directory
  --host <host>        Loopback host (default: 127.0.0.1)
  --port <port>        TCP port (default: 7331)
  --static-dir <path>  Frontend static asset root
  --pi                Enable the local Pi task runner
  -h, --help           Show help`;

async function main(args: string[]): Promise<number> {
  let options: StartWorkbenchServerOptions;
  try {
    const parsed = parseArgs({
      args,
      options: {
        workspace: { type: "string" },
        host: { type: "string" },
        port: { type: "string" },
        "static-dir": { type: "string" },
        pi: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: false,
      strict: true,
    });
    if (parsed.values.help === true) {
      console.log(HELP);
      return 0;
    }
    if (parsed.values.workspace === undefined) {
      console.error("Error: --workspace is required.");
      return 1;
    }
    const port = parsed.values.port === undefined
      ? undefined
      : Number(parsed.values.port);
    options = {
      workspaceDir: parsed.values.workspace,
      ...(parsed.values.pi ? { runner: createPiRunner() } : {}),
      ...(parsed.values.host === undefined ? {} : { host: parsed.values.host }),
      ...(port === undefined ? {} : { port }),
      ...(parsed.values["static-dir"] === undefined
        ? {}
        : { staticDir: parsed.values["static-dir"] }),
    };
  } catch {
    console.error("Error: invalid Workbench arguments.");
    return 1;
  }

  try {
    const server = await startWorkbenchServer(options);
    console.log(`ProjectOps Workbench listening at ${server.origin}`);
    await waitForShutdownSignal();
    await server.close();
    return 0;
  } catch (error) {
    const message = error instanceof WorkbenchServerStartError
      ? error.message
      : "Workbench server failed.";
    console.error(`Error: ${message}`);
    return 1;
  }
}

function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    const shutdown = (): void => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      resolve();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

process.exitCode = await main(process.argv.slice(2));
