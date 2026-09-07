#!/usr/bin/env node

import { runAsyncCli } from "./app.js";

process.exitCode = await runAsyncCli(process.argv.slice(2), {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
});
