// Create an argon2id hash for ADMIN_PASSWORD_HASH.
// Usage: pnpm --filter @nodewatch/server hash-password            (prompts, input hidden)
//        printf '%s' "$PW" | pnpm --filter @nodewatch/server hash-password --stdin
import { stdin, stdout } from "node:process";
import { hashPassword } from "../apps/server/src/auth/password.ts";

async function readHidden(prompt: string): Promise<string> {
  stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let buf = "";
    if (!stdin.isTTY) return reject(new Error("no TTY: use --stdin"));
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch: string) => {
      if (ch === "\r" || ch === "\n") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        stdout.write("\n");
        resolve(buf);
      } else if (ch === "\u0003") {
        process.exit(130);
      } else if (ch === "\u007f") {
        buf = buf.slice(0, -1);
      } else buf += ch;
    };
    stdin.on("data", onData);
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

async function main() {
  let pw: string;
  if (process.argv.includes("--stdin")) pw = await readStdin();
  else {
    pw = await readHidden("Admin password: ");
    const again = await readHidden("Repeat: ");
    if (pw !== again) throw new Error("passwords do not match");
  }
  const h = await hashPassword(pw);
  // Single-quote it in .env: the hash contains `$`.
  stdout.write(`ADMIN_PASSWORD_HASH='${h}'\n`);
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
