import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readN8nRuntimeConfig } from "../src/config.mjs";

const runtime = readN8nRuntimeConfig();
const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptsDirectory, "..");
const n8nEntry = resolve(packageRoot, "node_modules", "n8n", "bin", "n8n");

const child = spawn(process.execPath, [n8nEntry, "start"], {
  cwd: packageRoot,
  env: {
    ...process.env,
    N8N_ENCRYPTION_KEY: runtime.encryptionKey,
    N8N_HOST: runtime.host,
    N8N_LISTEN_ADDRESS: runtime.listenAddress,
    N8N_PORT: String(runtime.port),
    N8N_PROTOCOL: runtime.protocol,
    N8N_PUBLIC_API_DISABLED: "true",
    N8N_COMMUNITY_PACKAGES_ENABLED: "false",
    N8N_BLOCK_ENV_ACCESS_IN_NODE: "true",
    N8N_SSRF_PROTECTION_ENABLED: "true",
    N8N_DIAGNOSTICS_ENABLED: "false",
    N8N_VERSION_NOTIFICATIONS_ENABLED: "false",
    N8N_PERSONALIZATION_ENABLED: "false",
    N8N_DEFAULT_BINARY_DATA_MODE: "default",
    N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: "true",
    NODES_INCLUDE: JSON.stringify(runtime.nodeAllowlist),
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

child.stdout?.pipe(process.stdout);
child.stderr?.pipe(process.stderr);

let stopping = false;
function forwardSignal(signal) {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
}

process.once("SIGINT", () => forwardSignal("SIGINT"));
process.once("SIGTERM", () => forwardSignal("SIGTERM"));

child.once("error", (error) => {
  console.error(`n8n_start_failed: ${error.message}`);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal && !stopping) {
    console.error(`n8n_stopped_by_signal: ${signal}`);
  }
  process.exitCode = code ?? (stopping ? 0 : 1);
});
