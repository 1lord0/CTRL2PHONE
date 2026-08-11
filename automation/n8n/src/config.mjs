const MIN_SECRET_LENGTH = 32;

export const SAFE_N8N_NODES = Object.freeze([
  "n8n-nodes-base.webhook",
  "n8n-nodes-base.respondToWebhook",
  "n8n-nodes-base.httpRequest",
  "n8n-nodes-base.set",
  "n8n-nodes-base.if",
  "n8n-nodes-base.switch",
  "n8n-nodes-base.merge",
  "n8n-nodes-base.stopAndError",
  "n8n-nodes-base.wait",
  "n8n-nodes-base.executeWorkflow",
  "n8n-nodes-base.executeWorkflowTrigger",
]);

function requiredString(env, name, minimumLength = 1) {
  const value = env[name]?.trim();
  if (!value || value.length < minimumLength) {
    throw new Error(`${name}_missing_or_too_short`);
  }
  return value;
}

function parsePort(raw) {
  const port = Number(raw ?? "5678");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("N8N_PORT_invalid");
  }
  return port;
}

function parseSupabaseUrl(raw) {
  const value = requiredString(raw, "SUPABASE_URL");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SUPABASE_URL_invalid");
  }
  if (url.protocol !== "https:") {
    throw new Error("SUPABASE_URL_must_use_https");
  }
  return url.origin;
}

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function parseWebhookUrl(raw) {
  const value = requiredString(raw, "CTRL2PHONE_WEBHOOK_URL");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CTRL2PHONE_WEBHOOK_URL_invalid");
  }
  const loopback = ["127.0.0.1", "::1", "[::1]", "localhost"].includes(
    url.hostname,
  );
  if (
    (!loopback && url.protocol !== "https:") ||
    (loopback && !["http:", "https:"].includes(url.protocol)) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("CTRL2PHONE_WEBHOOK_URL_insecure");
  }
  return url.toString();
}

function parseTimeout(raw) {
  const value = Number(raw ?? "180000");
  if (!Number.isInteger(value) || value < 10_000 || value > 600_000) {
    throw new Error("CTRL2PHONE_E2E_TIMEOUT_MS_invalid");
  }
  return value;
}

export function isServiceRoleKey(value) {
  if (value.startsWith("sb_secret_")) return value.length >= 20;
  return decodeJwtPayload(value)?.role === "service_role";
}

export function isAnonKey(value) {
  if (value.startsWith("sb_publishable_")) return value.length >= 20;
  return decodeJwtPayload(value)?.role === "anon";
}

export function readN8nRuntimeConfig(env = process.env) {
  const encryptionKey = requiredString(
    env,
    "N8N_ENCRYPTION_KEY",
    MIN_SECRET_LENGTH,
  );
  const host = env.N8N_HOST?.trim() || "127.0.0.1";
  const listenAddress = env.N8N_LISTEN_ADDRESS?.trim() || "127.0.0.1";
  if (!["127.0.0.1", "::1", "localhost"].includes(listenAddress)) {
    throw new Error("N8N_LISTEN_ADDRESS_must_be_loopback");
  }
  const protocol = env.N8N_PROTOCOL?.trim() || "http";
  if (!["http", "https"].includes(protocol)) {
    throw new Error("N8N_PROTOCOL_invalid");
  }

  return Object.freeze({
    encryptionKey,
    host,
    listenAddress,
    nodeAllowlist: SAFE_N8N_NODES,
    port: parsePort(env.N8N_PORT),
    protocol,
  });
}

export function readIntegrationConfig(env = process.env) {
  const runtime = readN8nRuntimeConfig(env);
  const webhookSecret = requiredString(
    env,
    "CTRL2PHONE_WEBHOOK_SECRET",
    MIN_SECRET_LENGTH,
  );
  const serviceRoleKey = requiredString(env, "SUPABASE_SERVICE_ROLE_KEY", 20);
  if (!isServiceRoleKey(serviceRoleKey)) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY_not_privileged");
  }

  return Object.freeze({
    ...runtime,
    webhookSecret,
    supabaseUrl: parseSupabaseUrl(env),
    serviceRoleKey,
  });
}

export function readE2eConfig(env = process.env) {
  const integration = readIntegrationConfig(env);
  const anonKey = requiredString(env, "SUPABASE_ANON_KEY", 20);
  if (!isAnonKey(anonKey)) {
    throw new Error("SUPABASE_ANON_KEY_not_anon");
  }
  return Object.freeze({
    ...integration,
    anonKey,
    webhookUrl: parseWebhookUrl(env),
    timeoutMs: parseTimeout(env.CTRL2PHONE_E2E_TIMEOUT_MS),
    imagePath: env.CTRL2PHONE_E2E_IMAGE_PATH?.trim() || null,
  });
}
