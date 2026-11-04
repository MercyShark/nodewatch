// Redaction for anything that leaves the box in a bundle. Files are allowlisted (never .env,
// secrets/, frpc.toml, keystores); text is scrubbed of keys, tokens and credentials.

/** The only things a diagnostic bundle may contain. */
export const ALLOWED_FILES = [
  "logs/execution.log",
  "logs/consensus.log",
  "logs/tunnel.log",
  "verdicts.json",
  "metrics.json",
  "versions.json",
  "config.json",
  "status.txt",
  "findings.json",
  "manifest.json",
] as const;

const DENY_PATH = [
  /(^|\/)\.env(\..*)?$/i,
  /(^|\/)secrets(\/|$)/i,
  /(^|\/)frpc\.toml$/i,
  /keystore/i,
  /(^|\/)UTC--/,
  /\.(key|pem|p12|pfx)$/i,
  /(^|\/)\.arkiv-provider-pass$/i,
  /password/i,
];

export function isAllowedPath(p: string): boolean {
  const norm = p.replace(/\\/g, "/").replace(/^\.\//, "");
  if (norm.includes("..")) return false;
  if (DENY_PATH.some((r) => r.test(norm))) return false;
  return (ALLOWED_FILES as readonly string[]).includes(norm);
}

const R = "[REDACTED]";

const RULES: [RegExp, string | ((...m: string[]) => string)][] = [
  // URL credentials: scheme://user:pass@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, `$1${R}@`],
  // Arkiv access keys in RPC URL paths (…arkiv.network/<key>)
  [/(arkiv\.network\/)[A-Za-z0-9_\-.~%]{8,}/gi, `$1${R}`],
  // Private keys / 32-byte secrets (0x + 64 hex). Tx hashes and entity keys look the same, so only
  // redact when labelled as a key, or when standing alone with no hash-like context.
  [/((?:private|priv|secret|signing)[_\s-]*key["']?\s*[:=]\s*["']?)(0x)?[0-9a-fA-F]{64}/gi, `$1${R}`],
  [/\b(PRIVATE_KEY|[A-Z_]*_KEY|[A-Z_]*SECRET[A-Z_]*|[A-Z_]*TOKEN[A-Z_]*|[A-Z_]*PASS(?:WORD)?[A-Z_]*)\s*=\s*\S+/g, `$1=${R}`],
  // key = "value" pairs (toml/ini/logs): token, auth_token, password, secret, api_key, access_key
  [/\b(auth[_-]?token|token|password|passwd|secret|api[_-]?key|access[_-]?key|meta_token)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&"']+)/gi, `$1$2${R}`],
  // Bearer tokens and JWTs
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, `$1 ${R}`],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, R],
  // AWS-like access key ids and secret keys
  [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, R],
  // Telegram bot tokens, Slack webhooks
  [/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, R],
  [/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g, `https://hooks.slack.com/services/${R}`],
  // Mnemonic-like sequences (12+ lowercase words labelled as mnemonic/seed)
  [/((?:mnemonic|seed(?:\s*phrase)?)\s*[:=]\s*)[a-z ]{20,}/gi, `$1${R}`],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of RULES) out = out.replace(re, rep as string);
  return out;
}

export function redactLines(lines: string[]): string[] {
  return lines.map(redact);
}
