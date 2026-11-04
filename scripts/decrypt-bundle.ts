// Decrypt a Nodewatch vault envelope (bundle or backup) with a recipient's private key.
//
//   DECRYPT_PRIVATE_KEY=0x… pnpm --filter @nodewatch/server decrypt-bundle <envelope.json | swarm-ref> [--out file]
//
// The private key is read from the environment only (never argv, so it stays out of shell history
// and `ps`). A 64-hex Swarm reference is fetched from BEE_API_URL (default http://127.0.0.1:1633).
// Output defaults to bundle.tar.gz in the current directory (inspect with `tar tzf bundle.tar.gz`).
import { readFileSync, writeFileSync } from "node:fs";
import { decryptEnvelope, isEnvelope } from "../apps/server/src/swarm/ecies.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args[outIdx + 1] : "bundle.tar.gz";
  const input = args.find((a, i) => !a.startsWith("--") && (outIdx < 0 || i !== outIdx + 1));
  const pk = process.env.DECRYPT_PRIVATE_KEY;
  if (!input || !out) {
    console.error("usage: DECRYPT_PRIVATE_KEY=0x… decrypt-bundle <envelope.json | swarm-ref> [--out file]");
    process.exit(2);
  }
  if (!pk || !/^(0x)?[0-9a-fA-F]{64}$/.test(pk)) {
    console.error("set DECRYPT_PRIVATE_KEY to the recipient's 32-byte hex private key");
    process.exit(2);
  }
  let text: string;
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(input)) {
    const bee = (process.env.BEE_API_URL ?? "http://127.0.0.1:1633").replace(/\/$/, "");
    const res = await fetch(`${bee}/bytes/${input.replace(/^0x/, "")}`);
    if (!res.ok) throw new Error(`Bee returned HTTP ${res.status}`);
    text = await res.text();
  } else {
    text = readFileSync(input, "utf8");
  }
  const env: unknown = JSON.parse(text);
  if (!isEnvelope(env)) throw new Error("input is not a Nodewatch envelope (a scheme=none sample is already plaintext)");
  const plain = decryptEnvelope(env, pk);
  writeFileSync(out, plain, { mode: 0o600 });
  console.log(`decrypted ${plain.length} bytes to ${out}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
