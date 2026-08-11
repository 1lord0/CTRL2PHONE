import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SAFE_N8N_NODES } from "../src/config.mjs";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const n8nEntry = resolve(packageRoot, "node_modules", "n8n", "bin", "n8n");
const userFolder = await mkdtemp(join(tmpdir(), "ctrl2phone-n8n-smoke-"));
const port = 5681;

const child = spawn(process.execPath, [n8nEntry, "start"], {
  cwd: packageRoot,
  env: {
    ...process.env,
    N8N_ENCRYPTION_KEY: "ctrl2phone-smoke-only-encryption-key-2026",
    N8N_USER_FOLDER: userFolder,
    N8N_HOST: "127.0.0.1",
    N8N_LISTEN_ADDRESS: "127.0.0.1",
    N8N_PORT: String(port),
    N8N_PROTOCOL: "http",
    N8N_SECURE_COOKIE: "false",
    N8N_DIAGNOSTICS_ENABLED: "false",
    N8N_VERSION_NOTIFICATIONS_ENABLED: "false",
    N8N_PERSONALIZATION_ENABLED: "false",
    N8N_RUNNERS_ENABLED: "false",
    N8N_LOG_LEVEL: "debug",
    N8N_PUBLIC_API_DISABLED: "true",
    N8N_COMMUNITY_PACKAGES_ENABLED: "false",
    N8N_BLOCK_ENV_ACCESS_IN_NODE: "true",
    N8N_SSRF_PROTECTION_ENABLED: "true",
    NODES_INCLUDE: JSON.stringify(SAFE_N8N_NODES),
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let output = "";
let exited = false;
child.stdout.on("data", (chunk) => {
  output = `${output}${chunk}`.slice(-8000);
});
child.stderr.on("data", (chunk) => {
  output = `${output}${chunk}`.slice(-8000);
});
child.once("exit", () => {
  exited = true;
});
child.once("error", (error) => {
  output = `${output}\nspawn_error: ${error.message}`.slice(-8000);
  exited = true;
});

// A clean Windows install may spend over a minute loading n8n's large module
// graph while antivirus scans it. The fixed upper bound prevents a hung smoke.
const deadline = Date.now() + 180_000;
let healthy = false;
try {
  while (!exited && Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {
      // Startup is asynchronous; retry until the fixed deadline.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
} finally {
  if (!exited) child.kill();
}

if (!healthy) {
  throw new Error(`n8n_smoke_healthcheck_failed\n${output}`);
}

console.log(JSON.stringify({ ok: true, health: 200, version: "2.33.6" }));
