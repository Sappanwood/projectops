import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const srcDir = path.resolve(import.meta.dirname, "../src/web");
const destDir = path.resolve(import.meta.dirname, "../dist/web");

if (existsSync(srcDir)) {
  mkdirSync(destDir, { recursive: true });
  cpSync(srcDir, destDir, {
    recursive: true,
    filter: (source) => !source.endsWith(".ts"),
  });
}

await build({
  bundle: true,
  entryPoints: [path.join(srcDir, "mermaidClient.ts")],
  format: "esm",
  minify: true,
  outfile: path.join(destDir, "mermaid.js"),
  platform: "browser",
  target: "es2022",
});
