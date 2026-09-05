import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const srcDir = path.resolve(import.meta.dirname, "../src/web");
const destDir = path.resolve(import.meta.dirname, "../dist/web");

if (existsSync(srcDir)) {
  mkdirSync(destDir, { recursive: true });
  cpSync(srcDir, destDir, {
    recursive: true,
    filter: (source) => !source.endsWith(".ts"),
  });
}
