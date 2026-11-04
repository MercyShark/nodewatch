# Swarm: files only Arkiv can read

## What goes where

| | Swarm | Arkiv |
|---|---|---|
| Diagnostic bundles (logs, verdict history, metrics snapshot, versions; secrets redacted) | ✓ encrypted envelope | index entity |
| Slow-query findings (for the Arkiv team) | ✓ encrypted envelope | index entity |
| Encrypted backups (node kit config + secrets, Nodewatch DB) | ✓ encrypted envelope (+ local copy) | index entity |
| Public sample bundle (sanitized) | ✓ unencrypted | index entity, `scheme=none` |
| Heartbeats | — | ✓ `nodewatch.heartbeat` |

Swarm holds the bytes. Arkiv holds a small, queryable, expiring index: `nodewatch.bundle` with `provider`, `kind`,
`recipient`, `swarmRef`, `sha256`, `scheme`, `sizeBytes` (see `schema.md`).

## How "only Arkiv can read it" works

```
bundle.tar.gz ─► random AES-256-GCM key K ─► ciphertext C
K ─► ECIES(secp256k1) to each recipient's public key ─► wrapped keys
envelope = { v:1, scheme:"ecies-secp256k1-v1", recipients:[{addr, wrappedKey}], iv, tag, C }
envelope ─► Bee upload (postage batch) ─► swarmRef      (a plain reference to ciphertext)
swarmRef + sha256 + recipient ─► nodewatch.bundle entity on Arkiv (30 days)
```

- **Recipient keys are web3-native.** The Arkiv engineer signs a fixed message in the UI with their wallet. Nodewatch
  recovers the public key from the signature (`viem` `recoverPublicKey`) and stores `{address, publicKey}`. No key
  files are exchanged.
- **The `swarmRef` field is safe to publish.** It is deliberately **not** a Swarm encrypted reference (those embed the
  decryption key). It points to an envelope that only the recipient's private key can open.
- **Redaction** runs before encryption, as an allowlist of files plus pattern redaction for keys, tokens and
  passwords. It is unit-tested (`apps/server/src/swarm/redact.test.ts`). `.env`, `secrets/` and `frpc.toml` are never
  included.
- **Decrypt** (recipient side):
  `DECRYPT_PRIVATE_KEY=0x… pnpm --filter @nodewatch/server decrypt-bundle <swarm-ref> --out bundle.tar.gz`.
  The key is read from the environment only, never from argv.

## Code

- Upload / read: `apps/server/src/swarm/bee.ts` (Bee HTTP API `/bytes`, postage batch header)
- Envelope: `apps/server/src/swarm/ecies.ts` (+ tests)
- Recipients: `apps/server/src/swarm/recipients.ts` (signature → public key)
- Bundle builder + index: `apps/server/src/swarm/tarball.ts`, `vault.ts`
- Decrypt CLI: `scripts/decrypt-bundle.ts`

## Live demo record

| | |
|---|---|
| Bee node / service | _pending: Swarm booth service or own Bee (`BEE_MODE=external`)_ |
| Postage batch ID | _pending_ |
| Batch provided by | _pending_ |
| Sample bundle entity key | _pending_ |
| Sample `swarmRef` + openable link | _pending_ |
| Encrypted bundle entity key + `swarmRef` | _pending_ |
| Demo video timestamp | _pending_ |

### One upload

1. Vault → **Add a recipient** → the recipient signs the shown message with their wallet.
2. Vault → **Create a bundle** → kind *Diagnostic* → choose recipients → create.
3. The UI shows the Swarm reference, the sha256 and the Arkiv entity key with an explorer link.

### One read

1. Query the index: `arkiv.schema = str('nodewatch.bundle') AND recipient = addr(0x…)`.
2. Take `swarmRef` from the entity and run `decrypt-bundle` with the recipient key.
3. `tar tzf bundle.tar.gz` lists the logs, the verdict history and the metrics snapshot.

## What got in the way

- Swarm encrypted references embed the key, so they can't go into a public Arkiv entity. That forced envelope
  encryption to the recipient instead of Bee's built-in encryption.
- A postage batch is required before any upload, so a fresh operator can't try the vault without one. Nodewatch
  keeps the local encrypted copy and shows "Swarm not configured" instead of failing.
