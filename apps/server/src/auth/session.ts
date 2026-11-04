// Sessions: iron-session sealData/unsealData in an httpOnly cookie (Secure when PUBLIC_ORIGIN is
// https), SameSite=Lax, 12 h. The seal carries a session id that must exist (and not be revoked)
// in the sessions table, so logout is server-side.
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Role, SessionUser } from "@nodewatch/shared";
import { sealData, unsealData } from "iron-session";
import type { Config } from "../config.js";
import type { DB } from "../db/index.js";

export const COOKIE = "nw_session";
export const SESSION_TTL_SEC = 12 * 3600;

interface Sealed {
  sid: string;
  uid: string;
  role: Role;
  address: string | null;
  method: SessionUser["method"];
}

/** SESSION_SECRET from env, or a random one generated once and kept (0600) in DATA_DIR. */
export function sessionSecret(cfg: Config): string {
  if (cfg.SESSION_SECRET) {
    if (cfg.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
    return cfg.SESSION_SECRET;
  }
  const dir = path.join(cfg.DATA_DIR, "keys");
  const file = path.join(dir, "session-secret");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const s = randomBytes(48).toString("base64url");
  writeFileSync(file, s, { mode: 0o600 });
  return s;
}

export class Sessions {
  constructor(
    private readonly db: DB,
    private readonly secret: string,
    readonly secure: boolean,
  ) {}

  async create(user: Omit<SessionUser, "id"> & { id?: string }): Promise<{ cookie: string; user: SessionUser }> {
    const now = Date.now();
    const uid = user.id ?? (user.method === "siwe" ? `siwe:${user.address!.toLowerCase()}` : "password:admin");
    this.db
      .prepare(
        `INSERT INTO users(id, role, address, method, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET role = excluded.role, last_login_at = excluded.last_login_at`,
      )
      .run(uid, user.role, user.address, user.method, now, now);
    const sid = randomUUID();
    this.db.prepare("INSERT INTO sessions(id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(sid, uid, now, now + SESSION_TTL_SEC * 1000);
    this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
    const sealed: Sealed = { sid, uid, role: user.role, address: user.address, method: user.method };
    const cookie = await sealData(sealed, { password: this.secret, ttl: SESSION_TTL_SEC });
    return { cookie, user: { id: uid, role: user.role, address: user.address, method: user.method } };
  }

  async read(cookie: string | undefined): Promise<(SessionUser & { sid: string }) | null> {
    if (!cookie) return null;
    let s: Partial<Sealed>;
    try {
      s = await unsealData<Partial<Sealed>>(cookie, { password: this.secret, ttl: SESSION_TTL_SEC });
    } catch {
      return null;
    }
    if (!s?.sid || !s.uid || !s.role || !s.method) return null;
    const row = this.db.prepare("SELECT revoked, expires_at FROM sessions WHERE id = ?").get(s.sid) as { revoked: number; expires_at: number } | undefined;
    if (!row || row.revoked || row.expires_at < Date.now()) return null;
    return { sid: s.sid, id: s.uid, role: s.role, address: s.address ?? null, method: s.method };
  }

  revoke(sid: string): void {
    this.db.prepare("UPDATE sessions SET revoked = 1 WHERE id = ?").run(sid);
  }

  cookieOptions() {
    return { path: "/", httpOnly: true, secure: this.secure, sameSite: "lax" as const, maxAge: SESSION_TTL_SEC };
  }
}
