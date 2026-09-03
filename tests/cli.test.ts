import assert from "node:assert/strict";
import test from "node:test";

import { runCli, VERSION } from "../src/app.js";
import type { CliIO } from "../src/io.js";

test("the CLI exposes its alpha help and version", () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CliIO = {
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  };

  assert.equal(runCli([], io), 0);
  assert.match(stdout[0] ?? "", /Usage: pops/);
  assert.equal(runCli(["--version"], io), 0);
  assert.equal(stdout.at(-1), VERSION);
  assert.deepEqual(stderr, []);
});

