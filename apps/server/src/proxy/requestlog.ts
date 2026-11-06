// One JSON line per request, appended to DATA_DIR/requests.jsonl for a log shipper (Grafana Alloy → Loki).
// Rotated by size: at 50 MB the file becomes requests.jsonl.1 and a new one starts; one previous file is kept.
import { appendFileSync, existsSync, renameSync, statSync } from "node:fs";
import path from "node:path";

export interface RequestLogLine {
  ts: number;
  node: string;
  method: string;
  ms: number;
  ok: boolean;
  code: number | null;
  error: string | null;
  shape: string | null;
  query: string | null;
}

export class RequestLog {
  readonly file: string;
  private size = 0;

  constructor(
    dataDir: string,
    private readonly node: string,
    private readonly maxBytes = 50 * 1024 * 1024,
  ) {
    this.file = path.join(dataDir, "requests.jsonl");
    try {
      this.size = existsSync(this.file) ? statSync(this.file).size : 0;
    } catch {
      this.size = 0;
    }
  }

  append(rows: Omit<RequestLogLine, "node">[]): void {
    if (rows.length === 0) return;
    const text = rows.map((r) => JSON.stringify({ ...r, node: this.node })).join("\n") + "\n";
    try {
      if (this.size + text.length > this.maxBytes) {
        renameSync(this.file, this.file + ".1");
        this.size = 0;
      }
      appendFileSync(this.file, text, { mode: 0o600 });
      this.size += text.length;
    } catch {
      /* the shipper file never breaks request handling */
    }
  }
}
