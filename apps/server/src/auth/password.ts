// Password fallback: argon2id hash in ADMIN_PASSWORD_HASH (made by scripts/hash-password.ts).
import { hash, verify } from "@node-rs/argon2";

// @node-rs/argon2 defaults to Argon2id (algorithm 2); parameters per OWASP guidance.
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  if (password.length < 12) throw new Error("use at least 12 characters");
  return hash(password, OPTS);
}

export async function verifyPassword(hashed: string | undefined, password: string): Promise<boolean> {
  if (!hashed || !hashed.startsWith("$argon2id$") || typeof password !== "string" || password.length > 1024) return false;
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}
