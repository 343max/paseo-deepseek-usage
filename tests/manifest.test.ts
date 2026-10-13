import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { USAGE_SOURCE_ICON, USAGE_SOURCE_ID, USAGE_SOURCE_LABEL } from "../shared/account.js";

const root = fileURLToPath(new URL("..", import.meta.url));

async function readJson(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(root, relativePath), "utf8"));
}

describe("usage source id", () => {
  it("is a valid Paseo id", () => {
    expect(USAGE_SOURCE_ID).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(USAGE_SOURCE_ID.length).toBeLessThanOrEqual(128);
  });

  it("is namespaced, because the daemon fails the second plugin that claims an id", () => {
    expect(USAGE_SOURCE_ID).not.toBe("deepseek");
    expect(USAGE_SOURCE_ID).toContain("max343");
    expect(USAGE_SOURCE_ID).toContain("deepseek");
  });

  it("keeps the user facing label plain", () => {
    expect(USAGE_SOURCE_LABEL).toBe("DeepSeek");
  });
});

describe("manifest", () => {
  it("installs under the package name and declares a Paseo floor that has usage sources", async () => {
    const manifest = await readJson("paseo-plugin.json");
    const pkg = await readJson("package.json");
    expect(manifest.id).toBe(pkg.name);
    // registerUsageSource needs 0.11; anything lower cannot even load this plugin.
    expect(String((manifest.requirements as Record<string, string>).paseo)).toMatch(/^>=\d+\.\d+/);
  });

  it("ships the files it references", async () => {
    const pkg = await readJson("package.json");
    const files = pkg.files as string[];
    for (const entry of ["paseo-plugin.json", "OVERVIEW.md", "README.md", "assets/"]) {
      expect(files).toContain(entry);
    }
    expect(existsSync(join(root, USAGE_SOURCE_ICON))).toBe(true);
  });
});

describe("icon", () => {
  it("stays inside the provider icon restrictions", async () => {
    const svg = await readFile(join(root, USAGE_SOURCE_ICON), "utf8");
    // The sanitizer rejects styles, scripts, foreignObject, event handlers, and external refs.
    for (const forbidden of ["<style", "<script", "foreignObject", "href=", "javascript:"]) {
      expect(svg.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(svg).not.toMatch(/\son[a-z]+\s*=/i);
    expect(svg.length).toBeLessThan(64 * 1024);
  });

  it("takes its colour from the theme", async () => {
    const svg = await readFile(join(root, USAGE_SOURCE_ICON), "utf8");
    expect(svg).toContain('fill="currentColor"');
  });
});

describe("README", () => {
  it("links only images that exist", async () => {
    const readme = await readFile(join(root, "README.md"), "utf8");
    const targets = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(existsSync(join(root, target)), `missing image: ${target}`).toBe(true);
    }
  });
});
