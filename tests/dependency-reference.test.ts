import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTaskReference,
  parsePlanDependency,
  taskReferenceKey,
} from "../src/backlog/dependencyReference.js";

test("task references resolve local and qualified identity without guessing prefixes", () => {
  const expected = { project: "mochi", item: "MOC-001" };
  assert.deepEqual(parseTaskReference("MOC-001", "mochi"), expected);
  assert.deepEqual(parseTaskReference("mochi:MOC-001", "mochi-write"), expected);
  assert.equal(taskReferenceKey(expected), "mochi:MOC-001");
  assert.deepEqual(
    parseTaskReference("MOC-001", "mochi"),
    parseTaskReference("mochi:MOC-001", "mochi"),
  );
  assert.deepEqual(parseTaskReference("MOC-001", "ccp"), { project: "ccp", item: "MOC-001" });
});

test("Plan distinguishes local keys from existing tasks even in the owning project", () => {
  assert.deepEqual(parsePlanDependency("prepare"), { kind: "local", key: "prepare" });
  assert.deepEqual(parsePlanDependency("mochi:MOC-001"), {
    kind: "task",
    reference: { project: "mochi", item: "MOC-001" },
  });
  assert.equal(parsePlanDependency("MOC-001"), null);
});

test("invalid project and item syntax never becomes a local reference", () => {
  for (const value of [
    "Mochi:MOC-001",
    "mochi_:MOC-001",
    "mochi::MOC-001",
    "../mochi:MOC-001",
    "mochi:MOC-1",
    " mochi:MOC-001",
    "mochi:",
  ]) {
    assert.equal(parseTaskReference(value, "mochi"), null, value);
    assert.equal(parsePlanDependency(value), null, value);
  }
  assert.equal(parseTaskReference("MOC-001", "Mochi"), null);
  assert.deepEqual(parseTaskReference("3d-app:A1-1000", "mochi"), {
    project: "3d-app",
    item: "A1-1000",
  });
});
