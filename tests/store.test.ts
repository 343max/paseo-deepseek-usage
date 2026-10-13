import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { piAuthPath, readApiKey } from "../server/store.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "deepseek-store-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("piAuthPath", () => {
  it("defaults to pi's own agent directory", () => {
    expect(piAuthPath({ home: "/home/tester", env: {} })).toBe(
      "/home/tester/.pi/agent/auth.json",
    );
  });

  it("honours PI_CODING_AGENT_DIR the way the bundled sources do", () => {
    expect(piAuthPath({ home: "/home/tester", env: { PI_CODING_AGENT_DIR: "/srv/pi" } })).toBe(
      "/srv/pi/auth.json",
    );
    expect(piAuthPath({ home: "/home/tester", env: { PI_CODING_AGENT_DIR: "~/custom" } })).toBe(
      "/home/tester/custom/auth.json",
    );
  });
});

describe("readApiKey", () => {
  it("reads the deepseek entry of pi's login store", async () => {
    const path = join(directory, "auth.json");
    await writeFile(
      path,
      JSON.stringify({
        deepseek: { type: "api_key", key: "sk-live" },
        openrouter: { type: "api_key", key: "sk-or" },
      }),
    );
    expect(await readApiKey({ store: "pi", locator: path })).toBe("sk-live");
  });

  it("returns null when the store has no DeepSeek login", async () => {
    const path = join(directory, "auth.json");
    await writeFile(path, JSON.stringify({ openrouter: { type: "api_key", key: "sk-or" } }));
    expect(await readApiKey({ store: "pi", locator: path })).toBeNull();
  });

  it("returns null for a missing or unreadable store instead of throwing", async () => {
    expect(await readApiKey({ store: "pi", locator: join(directory, "nope.json") })).toBeNull();
    const path = join(directory, "broken.json");
    await writeFile(path, "{not json");
    expect(await readApiKey({ store: "pi", locator: path })).toBeNull();
  });

  it("reads the environment variable when that is the store", async () => {
    expect(
      await readApiKey(
        { store: "env", locator: "DEEPSEEK_API_KEY" },
        { env: { DEEPSEEK_API_KEY: " sk-env " } },
      ),
    ).toBe("sk-env");
    expect(await readApiKey({ store: "env", locator: "DEEPSEEK_API_KEY" }, { env: {} })).toBeNull();
  });
});
