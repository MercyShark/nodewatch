import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { testCtx } from "../test/helpers.js";
import { checkRecipientMessage } from "./recipients.js";
import { Vault } from "./vault.js";

const uiMessage = (label: string, address: string) =>
  ["Nodewatch vault recipient", "I allow encrypted Nodewatch bundles to be addressed to this wallet.", `Label: ${label}`, `Address: ${address}`, "Nonce: abc123"].join("\n");

describe("recipient message", () => {
  it("accepts the UI format and extracts the address", () => {
    const a = privateKeyToAccount(generatePrivateKey()).address;
    expect(checkRecipientMessage(uiMessage("x", a))).toBe(a.toLowerCase());
    expect(() => checkRecipientMessage("hello")).toThrow();
    expect(() => checkRecipientMessage("Nodewatch vault recipient\nno address")).toThrow();
  });

  it("registers a recipient from (message, signature) and rejects a mismatched Address line", async () => {
    const ctx = testCtx();
    const vault = new Vault(ctx);
    const acct = privateKeyToAccount(generatePrivateKey());
    const message = uiMessage("arkiv", acct.address);
    const signature = await acct.signMessage({ message });
    const r = await vault.addRecipient({ label: "arkiv", address: acct.address, signature, message });
    expect(r.address).toBe(acct.address.toLowerCase());
    const other = privateKeyToAccount(generatePrivateKey());
    const bad = uiMessage("x", other.address);
    await expect(vault.addRecipient({ label: "x", signature: await acct.signMessage({ message: bad }), message: bad })).rejects.toThrow(/signature was made by/);
  });
});
