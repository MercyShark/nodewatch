// The provider key, unlocked in memory only. The keystore file stays encrypted on disk; the password is used once
// to decrypt and then discarded. The key lives in this process until lock() or a restart, is never logged, never
// written, and is handed out only to the two autopilot actions that need a provider signature (post-offer, tunnel
// token). PROVIDER_KEYSTORE_PASSWORD in .env unlocks at boot for operators who want true zero-touch.
import { readFileSync } from "node:fs";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decryptKeystore, keystoreAddress, WrongPasswordError } from "./keystore.js";

export class ProviderUnlock {
  private key: Hex | null = null;
  private unlockedAt: number | null = null;
  readonly address: string | null;
  readonly keystoreError: string | null;

  constructor(private readonly keystorePath: string) {
    try {
      this.address = keystoreAddress(readFileSync(keystorePath, "utf8"));
      this.keystoreError = null;
    } catch (err) {
      this.address = null;
      this.keystoreError = `cannot read the provider keystore at ${keystorePath}: ${(err as Error).message}`;
    }
  }

  get unlocked(): boolean {
    return this.key !== null;
  }

  get since(): number | null {
    return this.unlockedAt;
  }

  /** Throws WrongPasswordError on a bad password. A wrong password never changes the current state. */
  unlock(password: string): string {
    const json = readFileSync(this.keystorePath, "utf8");
    const key = decryptKeystore(json, password); // throws WrongPasswordError
    const addr = privateKeyToAccount(key).address;
    this.key = key;
    this.unlockedAt = Date.now();
    return addr;
  }

  lock(): void {
    this.key = null;
    this.unlockedAt = null;
  }

  /** Only the autopilot calls this. Throws if locked. */
  use<T>(fn: (key: Hex) => T): T {
    if (!this.key) throw new ProviderLockedError();
    return fn(this.key);
  }
}

export class ProviderLockedError extends Error {
  constructor() {
    super("the provider key is locked: unlock it in Nodewatch (Pool → Autopilot) or set PROVIDER_KEYSTORE_PASSWORD");
  }
}

export { WrongPasswordError };
