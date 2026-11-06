// Self-setup for a plain `docker run`: everything install.sh used to prepare, done at boot instead.
//   - the heartbeat wallet: created once and kept in the data volume (keys/heartbeat-key, mode 600);
//   - the provider address: read from the node kit's keystore when PROVIDER_ADDRESS is not given;
//   - the Telegram chat: found from the first message sent to the bot when only TELEGRAM_BOT_TOKEN is given.
// Nothing here ever reads the provider key itself; the keystore file only reveals its public address.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { kitPaths } from "./autopilot/kitfiles.js";
import { keystoreAddress } from "./autopilot/keystore.js";
import type { Config } from "./config.js";
import type { DB } from "./db/index.js";
import { getSetting, setSetting } from "./db/index.js";
import type { Logger } from "./log.js";
import { fetchWithTimeout } from "./util/http.js";

export function ensureHeartbeatKey(cfg: Config, log: Logger): void {
  if (cfg.HEARTBEAT_PRIVATE_KEY) return;
  const dir = path.join(cfg.DATA_DIR, "keys");
  const file = path.join(dir, "heartbeat-key");
  let key: string;
  let created = false;
  if (existsSync(file)) key = readFileSync(file, "utf8").trim();
  else {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    key = generatePrivateKey();
    writeFileSync(file, key, { mode: 0o600 });
    created = true;
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${file} does not hold a 0x-prefixed 32-byte key`);
  cfg.HEARTBEAT_PRIVATE_KEY = key;
  cfg.BUNDLE_WRITER_PRIVATE_KEY ??= key;
  const address = privateKeyToAccount(key as `0x${string}`).address;
  log.info(
    { address, created },
    created
      ? "created the heartbeat wallet; fund it with a little tGLM (https://hub.arkiv.network/faucet) to publish heartbeats"
      : "using the heartbeat wallet from the data volume",
  );
}

export function providerFromKit(cfg: Config, log: Logger): void {
  if (cfg.PROVIDER_ADDRESS || !cfg.NODE_KIT_DIR) return;
  try {
    cfg.PROVIDER_ADDRESS = keystoreAddress(readFileSync(kitPaths(cfg.NODE_KIT_DIR).keystore, "utf8"));
    log.info({ provider: cfg.PROVIDER_ADDRESS }, "provider address read from the node kit's keystore");
  } catch {
    log.warn("PROVIDER_ADDRESS is not set and the node kit's keystore is not readable; pool views stay empty until it is");
  }
}

/** A chat id found earlier survives restarts; an explicit TELEGRAM_CHAT_ID always wins. */
export function loadTelegramChat(cfg: Config, db: DB): void {
  if (!cfg.TELEGRAM_CHAT_ID) cfg.TELEGRAM_CHAT_ID = getSetting<string | undefined>(db, "telegramChatId", undefined);
}

interface Update {
  update_id: number;
  message?: { chat?: { id: number; type?: string }; date?: number };
}

/**
 * While only the bot token is known, look for the first chat that messaged the bot (send it /start). Once found, save
 * it, say hello there, and stop looking. Runs every 20 s until linked; one cheap getUpdates call each time.
 */
export async function linkTelegramChat(cfg: Config, db: DB, log: Logger, node: string): Promise<void> {
  const token = cfg.TELEGRAM_BOT_TOKEN;
  if (!token || cfg.TELEGRAM_CHAT_ID) return;
  const redact = (s: string) => s.replaceAll(token, "<bot-token>");
  try {
    const res = await fetchWithTimeout(`https://api.telegram.org/bot${token}/getUpdates?limit=50&allowed_updates=%5B%22message%22%5D`, {}, 10_000);
    const body = (await res.json()) as { ok: boolean; result?: Update[]; description?: string };
    if (!body.ok) throw new Error(body.description ?? `HTTP ${res.status}`);
    const msgs = (body.result ?? []).filter((u) => u.message?.chat?.id !== undefined);
    const pick = [...msgs].reverse().find((u) => u.message?.chat?.type === "private") ?? msgs.at(-1);
    if (!pick) return;
    const chat = String(pick.message!.chat!.id);
    cfg.TELEGRAM_CHAT_ID = chat;
    setSetting(db, "telegramChatId", chat);
    await fetchWithTimeout(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: `Nodewatch is connected. Alerts for ${node} will arrive in this chat.` }),
      },
      10_000,
    );
    log.info({ chatType: pick.message?.chat?.type }, "telegram chat linked from the first message to the bot");
  } catch (err) {
    log.warn({ err: redact(String((err as Error)?.message ?? err)) }, "telegram: could not look for the chat yet");
  }
}
