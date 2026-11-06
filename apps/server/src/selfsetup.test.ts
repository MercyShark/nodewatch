import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate, getSetting } from "./db/index.js";
import { ensureHeartbeatKey, linkTelegramChat, loadTelegramChat } from "./selfsetup.js";
import type { Config } from "./config.js";

const log = { info: vi.fn(), warn: vi.fn() } as never;

describe("self-setup for docker run", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates the heartbeat wallet once, mode 600, and reuses it after a restart", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nw-"));
    const a = { DATA_DIR: dir } as Config;
    ensureHeartbeatKey(a, log);
    expect(a.HEARTBEAT_PRIVATE_KEY).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.BUNDLE_WRITER_PRIVATE_KEY).toBe(a.HEARTBEAT_PRIVATE_KEY);
    const file = path.join(dir, "keys", "heartbeat-key");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const b = { DATA_DIR: dir } as Config;
    ensureHeartbeatKey(b, log);
    expect(b.HEARTBEAT_PRIVATE_KEY).toBe(a.HEARTBEAT_PRIVATE_KEY);
    expect(readFileSync(file, "utf8").trim()).toBe(a.HEARTBEAT_PRIVATE_KEY);
  });

  it("keeps an explicit HEARTBEAT_PRIVATE_KEY", () => {
    const k = `0x${"11".repeat(32)}`;
    const c = { DATA_DIR: mkdtempSync(path.join(tmpdir(), "nw-")), HEARTBEAT_PRIVATE_KEY: k } as Config;
    ensureHeartbeatKey(c, log);
    expect(c.HEARTBEAT_PRIVATE_KEY).toBe(k);
  });

  it("links the Telegram chat from the first private message, says hello, and remembers it", async () => {
    const db = new Database(":memory:");
    migrate(db);
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url).replace(/bot[^/]+/, "bot<t>"));
        if (String(url).includes("getUpdates"))
          return new Response(JSON.stringify({ ok: true, result: [{ update_id: 1, message: { chat: { id: -100, type: "group" } } }, { update_id: 2, message: { chat: { id: 4242, type: "private" } } }] }));
        return new Response(JSON.stringify({ ok: true }));
      }),
    );
    const cfg = { TELEGRAM_BOT_TOKEN: "123:abc" } as Config;
    await linkTelegramChat(cfg, db, log, "node-1");
    expect(cfg.TELEGRAM_CHAT_ID).toBe("4242");
    expect(getSetting(db, "telegramChatId", null)).toBe("4242");
    expect(calls.some((c) => c.includes("sendMessage"))).toBe(true);
    const fresh = { TELEGRAM_BOT_TOKEN: "123:abc" } as Config;
    loadTelegramChat(fresh, db);
    expect(fresh.TELEGRAM_CHAT_ID).toBe("4242");
  });

  it("does nothing until someone messages the bot, and never logs the token", async () => {
    const db = new Database(":memory:");
    migrate(db);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, description: "Unauthorized for bot 123:abc" }))));
    const warn = vi.fn();
    const cfg = { TELEGRAM_BOT_TOKEN: "123:abc" } as Config;
    await linkTelegramChat(cfg, db, { info: vi.fn(), warn } as never, "n");
    expect(cfg.TELEGRAM_CHAT_ID).toBeUndefined();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("123:abc");
  });
});
