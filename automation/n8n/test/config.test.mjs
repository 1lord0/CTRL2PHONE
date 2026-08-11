import test from "node:test";
import assert from "node:assert/strict";
import {
  SAFE_N8N_NODES,
  isAnonKey,
  isServiceRoleKey,
  readE2eConfig,
  readIntegrationConfig,
  readN8nRuntimeConfig,
} from "../src/config.mjs";

const encryptionKey = "e".repeat(32);
const webhookSecret = "w".repeat(32);

test("runtime config rejects a short encryption key", () => {
  assert.throws(
    () => readN8nRuntimeConfig({ N8N_ENCRYPTION_KEY: "short" }),
    /N8N_ENCRYPTION_KEY_missing_or_too_short/,
  );
});

test("runtime config validates port and protocol", () => {
  assert.throws(
    () =>
      readN8nRuntimeConfig({
        N8N_ENCRYPTION_KEY: encryptionKey,
        N8N_PORT: "0",
      }),
    /N8N_PORT_invalid/,
  );
  assert.throws(
    () =>
      readN8nRuntimeConfig({
        N8N_ENCRYPTION_KEY: encryptionKey,
        N8N_PROTOCOL: "file",
      }),
    /N8N_PROTOCOL_invalid/,
  );
});

test("runtime config is loopback-only and exposes the minimal node allowlist", () => {
  const config = readN8nRuntimeConfig({ N8N_ENCRYPTION_KEY: encryptionKey });
  assert.equal(config.listenAddress, "127.0.0.1");
  assert.deepEqual(config.nodeAllowlist, SAFE_N8N_NODES);
  assert.equal(SAFE_N8N_NODES.includes("n8n-nodes-base.executeCommand"), false);
  assert.equal(SAFE_N8N_NODES.includes("n8n-nodes-base.readWriteFile"), false);

  assert.throws(
    () =>
      readN8nRuntimeConfig({
        N8N_ENCRYPTION_KEY: encryptionKey,
        N8N_LISTEN_ADDRESS: "0.0.0.0",
      }),
    /N8N_LISTEN_ADDRESS_must_be_loopback/,
  );
});

test("integration config accepts a new Supabase secret key without exposing it", () => {
  const serviceRoleKey = `sb_secret_${"s".repeat(32)}`;
  const config = readIntegrationConfig({
    N8N_ENCRYPTION_KEY: encryptionKey,
    CTRL2PHONE_WEBHOOK_SECRET: webhookSecret,
    SUPABASE_URL: "https://example.supabase.co/path",
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  });

  assert.equal(config.supabaseUrl, "https://example.supabase.co");
  assert.equal(config.serviceRoleKey, serviceRoleKey);
});

test("integration config rejects publishable and anon-looking keys", () => {
  for (const key of [
    `sb_publishable_${"p".repeat(32)}`,
    `anon_${"a".repeat(32)}`,
  ]) {
    assert.throws(
      () =>
        readIntegrationConfig({
          N8N_ENCRYPTION_KEY: encryptionKey,
          CTRL2PHONE_WEBHOOK_SECRET: webhookSecret,
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: key,
        }),
      /SUPABASE_SERVICE_ROLE_KEY_not_privileged/,
    );
  }
});

test("legacy service-role JWTs are recognized by their payload role", () => {
  const payload = Buffer.from(
    JSON.stringify({ role: "service_role" }),
  ).toString("base64url");
  assert.equal(isServiceRoleKey(`header.${payload}.signature`), true);
});

test("integration config requires HTTPS Supabase URLs", () => {
  assert.throws(
    () =>
      readIntegrationConfig({
        N8N_ENCRYPTION_KEY: encryptionKey,
        CTRL2PHONE_WEBHOOK_SECRET: webhookSecret,
        SUPABASE_URL: "http://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${"s".repeat(32)}`,
      }),
    /SUPABASE_URL_must_use_https/,
  );
});

test("e2e config accepts publishable keys and loopback HTTP webhooks", () => {
  const config = readE2eConfig({
    N8N_ENCRYPTION_KEY: encryptionKey,
    CTRL2PHONE_WEBHOOK_SECRET: webhookSecret,
    CTRL2PHONE_WEBHOOK_URL:
      "http://127.0.0.1:5678/webhook/ctrl2phone-action",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${"s".repeat(32)}`,
    SUPABASE_ANON_KEY: `sb_publishable_${"p".repeat(32)}`,
  });
  assert.equal(config.timeoutMs, 180000);
  assert.equal(isAnonKey(config.anonKey), true);
});

test("e2e config rejects privileged anon keys and insecure remote webhooks", () => {
  const base = {
    N8N_ENCRYPTION_KEY: encryptionKey,
    CTRL2PHONE_WEBHOOK_SECRET: webhookSecret,
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${"s".repeat(32)}`,
  };
  assert.throws(
    () =>
      readE2eConfig({
        ...base,
        SUPABASE_ANON_KEY: `sb_secret_${"s".repeat(32)}`,
        CTRL2PHONE_WEBHOOK_URL:
          "http://127.0.0.1:5678/webhook/ctrl2phone-action",
      }),
    /SUPABASE_ANON_KEY_not_anon/,
  );
  assert.throws(
    () =>
      readE2eConfig({
        ...base,
        SUPABASE_ANON_KEY: `sb_publishable_${"p".repeat(32)}`,
        CTRL2PHONE_WEBHOOK_URL: "http://remote.example/webhook/action",
      }),
    /CTRL2PHONE_WEBHOOK_URL_insecure/,
  );
});
