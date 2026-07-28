import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.argv[2] ?? ".env");
let content = readFileSync(envPath, "utf8");
const existing = content.match(/^AUTH_BOOTSTRAP_TOKEN=["']?([^"'\r\n ]*)/m)?.[1] ?? "";
let token = existing;

if (!token) {
  token = randomBytes(32).toString("hex");
  const line = `AUTH_BOOTSTRAP_TOKEN="${token}"`;
  content = /^AUTH_BOOTSTRAP_TOKEN=.*$/m.test(content)
    ? content.replace(/^AUTH_BOOTSTRAP_TOKEN=.*$/m, line)
    : `${content.trimEnd()}\n${line}\n`;
  const temporaryPath = `${envPath}.bootstrap-token.tmp`;
  writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, envPath);
  try {
    chmodSync(envPath, 0o600);
  } catch {
    // Windows may not expose POSIX permissions; the file is still local and
    // excluded from Git.
  }
}

process.stdout.write(token);
