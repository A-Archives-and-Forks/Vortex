import * as fs from "node:fs";
import * as path from "node:path";

import { describe, it, expect } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Discover package.json files under packages/ and packages/adaptors/.
 * Skips directories that have no package.json (empty adaptor stubs).
 */
function discoverPackages(): { name: string; dir: string; pkg: Record<string, unknown> }[] {
  const results: { name: string; dir: string; pkg: Record<string, unknown> }[] = [];

  for (const searchDir of ["packages", path.join("packages", "adaptors")]) {
    const abs = path.join(ROOT, searchDir);
    if (!fs.existsSync(abs)) continue;

    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgPath = path.join(abs, entry.name, "package.json");
      if (!fs.existsSync(pkgPath)) continue;

      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      results.push({
        name: pkg.name ?? entry.name,
        dir: path.relative(ROOT, path.join(abs, entry.name)),
        pkg,
      });
    }
  }

  return results;
}

function hasRuntimeEntryPoint(pkg: Record<string, unknown>): boolean {
  return pkg.main !== undefined || pkg.module !== undefined;
}

function pointsToTs(value: unknown): boolean {
  return typeof value === "string" && /\.tsx?$/.test(value);
}

// vortex-api is a type-only shim -- its "main" file doesn't exist on disk and
// it's resolved via webpack aliases at runtime, not through Node's require().
const EXCLUDED = new Set(["vortex-api"]);

const packages = discoverPackages().filter(
  (p) => hasRuntimeEntryPoint(p.pkg) && !EXCLUDED.has(p.name),
);

describe("workspace packages under packages/ must have a build setup", () => {
  for (const { name, dir, pkg } of packages) {
    describe(name, () => {
      it("has a build script", () => {
        const scripts = pkg.scripts as Record<string, string> | undefined;
        expect(scripts?.build, `${dir}/package.json is missing a "build" script`).toBeDefined();
      });

      it("main does not point to .ts source", () => {
        if (pkg.main === undefined) return;
        expect(
          pointsToTs(pkg.main),
          `${dir}/package.json "main" points to TypeScript source (${pkg.main}). It must point to compiled output.`,
        ).toBe(false);
      });

      it("module does not point to .ts source", () => {
        if (pkg.module === undefined) return;
        expect(
          pointsToTs(pkg.module),
          `${dir}/package.json "module" points to TypeScript source (${pkg.module}). It must point to compiled output.`,
        ).toBe(false);
      });
    });
  }
});
