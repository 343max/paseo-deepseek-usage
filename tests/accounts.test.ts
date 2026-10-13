import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accountKeyFor, discoverAccounts } from "../server/accounts.js";

let home: string;
let authPath: string;

async function writePiStore(contents: unknown): Promise<void> {
  await mkdir(join(home, ".pi", "agent"), { recursive: true });
  await writeFile(authPath, JSON.stringify(contents));
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "deepseek-accounts-"));
  authPath = join(home, ".pi", "agent", "auth.json");
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("accountKeyFor", () => {
  it("is a stable, Paseo-safe key that is not the credential", () => {
    const key = accountKeyFor({ store: "pi", locator: "/home/tester/.pi/agent/auth.json" });
    expect(key).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
    expect(key).toBe(accountKeyFor({ store: "pi", locator: "/home/tester/.pi/agent/auth.json" }));
    expect(key).not.toBe(accountKeyFor({ store: "env", locator: "DEEPSEEK_API_KEY" }));
  });
});

describe("global discovery", () => {
  it("prefers pi's login store over the environment", async () => {
    await writePiStore({ deepseek: { type: "api_key", key: "sk-live" } });
    const accounts = await discoverAccounts({ kind: "global" }, { home, env: { HOME: home, DEEPSEEK_API_KEY: "sk-env" } });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].input).toEqual({ store: "pi", locator: authPath });
    expect(accounts[0].harness).toBe("Pi");
    expect(accounts[0].label).toBeUndefined();
  });

  it("falls back to the environment variable", async () => {
    const accounts = await discoverAccounts(
      { kind: "global" },
      { home, env: { HOME: home, DEEPSEEK_API_KEY: "sk-env" } },
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].input).toEqual({ store: "env", locator: "DEEPSEEK_API_KEY" });
    expect(accounts[0].harness).toBe("Environment");
  });

  it("reports nothing when there is no login at all", async () => {
    expect(await discoverAccounts({ kind: "global" }, { home, env: { HOME: home } })).toEqual([]);
  });
});

describe("session discovery", () => {
  it("ignores sessions from other harnesses", async () => {
    await writePiStore({ deepseek: { type: "api_key", key: "sk-live" } });
    const accounts = await discoverAccounts({
      kind: "session",
      provider: "claude",
      model: "anthropic/claude-sonnet-4",
      env: { HOME: home },
    });
    expect(accounts).toEqual([]);
  });

  it("ignores a pi session that only uses DeepSeek through another provider", async () => {
    await writePiStore({ deepseek: { type: "api_key", key: "sk-live" } });
    const accounts = await discoverAccounts({
      kind: "session",
      provider: "pi",
      model: "openrouter/deepseek-v4-pro",
      env: { HOME: home },
    });
    expect(accounts).toEqual([]);
  });

  it("finds pi's DeepSeek login for a deepseek/ session", async () => {
    await writePiStore({ deepseek: { type: "api_key", key: "sk-live" } });
    const accounts = await discoverAccounts({
      kind: "session",
      provider: "pi",
      model: "deepseek/deepseek-flash",
      env: { HOME: home },
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].input).toEqual({ store: "pi", locator: authPath });
  });

  it("prefers the session's own key when it was launched with one", async () => {
    await writePiStore({ deepseek: { type: "api_key", key: "sk-live" } });
    const accounts = await discoverAccounts({
      kind: "session",
      provider: "pi",
      model: "deepseek/deepseek-flash",
      env: { HOME: home, DEEPSEEK_API_KEY: "sk-session" },
    });
    expect(accounts[0].input).toEqual({ store: "env", locator: "DEEPSEEK_API_KEY" });
  });

  it("excludes a session pointed at a foreign DeepSeek-compatible endpoint", async () => {
    await writePiStore({ deepseek: { type: "api_key", key: "sk-live" } });
    const accounts = await discoverAccounts({
      kind: "session",
      provider: "pi",
      model: "deepseek/deepseek-flash",
      env: { HOME: home, DEEPSEEK_BASE_URL: "https://proxy.example.com/v1" },
    });
    expect(accounts).toEqual([]);
  });
});
