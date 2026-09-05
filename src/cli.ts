#!/usr/bin/env node

import { runCli } from "./app.js";

process.exitCode = runCli(process.argv.slice(2), {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
});
