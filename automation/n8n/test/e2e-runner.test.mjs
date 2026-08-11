import test from "node:test";
import assert from "node:assert/strict";

import { runCtrl2PhoneE2e } from "../src/e2e-runner.mjs";

const ownerId = "123e4567-e89b-42d3-a456-426614174100";
const mobileId = "123e4567-e89b-42d3-a456-426614174101";
const channelId = "123e4567-e89b-42d3-a456-426614174200";
const taskId = "123e4567-e89b-42d3-a456-426614174300";

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createFakeApi({ failWebhook = false } = {}) {
  const calls = [];
  let signups = 0;
  let taskReads = 0;
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    const method = options.method ?? "GET";
    calls.push({ url, method, headers: options.headers, body: options.body });

    if (url.pathname === "/auth/v1/signup") {
      const isOwner = signups++ === 0;
      return json({
        access_token: isOwner ? "owner-access" : "mobile-access",
        user: { id: isOwner ? ownerId : mobileId },
      });
    }
    if (url.pathname === "/rest/v1/rpc/create_action_channel") {
      return json(channelId);
    }
    if (url.pathname === "/rest/v1/rpc/claim_action_channel") {
      return json(channelId);
    }
    if (url.pathname.startsWith("/storage/v1/object/") && method === "POST") {
      return json({ Key: "uploaded" });
    }
    if (url.pathname === "/rest/v1/rpc/enqueue_action_task") {
      return json(taskId);
    }
    if (url.pathname === "/webhook/ctrl2phone-action") {
      return failWebhook
        ? json({ error: "broken" }, 500)
        : json({ accepted: true, taskId }, 202);
    }
    if (url.pathname === "/rest/v1/action_tasks" && method === "GET") {
      taskReads++;
      return json([
        {
          id: taskId,
          channel_id: channelId,
          intent_type: "general_visual_analysis",
          workflow_status: taskReads === 1 ? "analyzing" : "completed",
          progress: taskReads === 1 ? 20 : 100,
          title: "E2E",
          summary: "ok",
          result_json: { description: "blank image" },
          sources: [],
          confidence: 1,
          error_code: null,
          error_message: null,
          version: taskReads,
          updated_at: "2026-08-07T12:00:00Z",
          completed_at: taskReads === 1 ? null : "2026-08-07T12:00:00Z",
        },
      ]);
    }
    if (url.pathname === "/rest/v1/rpc/set_action_task_user_state") {
      return json({
        task_id: taskId,
        read_at: "2026-08-07T12:00:00Z",
        pinned_at: "2026-08-07T12:00:00Z",
      });
    }
    if (method === "DELETE") return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  return { calls, fetchImpl };
}

const config = {
  supabaseUrl: "https://example.supabase.co",
  serviceRoleKey: `sb_secret_${"s".repeat(32)}`,
  anonKey: `sb_publishable_${"p".repeat(32)}`,
  webhookUrl: "http://127.0.0.1:5678/webhook/ctrl2phone-action",
  webhookSecret: "w".repeat(32),
  timeoutMs: 30_000,
  imagePath: null,
};

test("e2e runner verifies pairing, workflow result, mobile state and cleanup", async () => {
  const api = createFakeApi();
  let milliseconds = 0;
  let randomCall = 0;
  const result = await runCtrl2PhoneE2e(config, {
    fetchImpl: api.fetchImpl,
    randomBytes: () => Buffer.alloc(32, ++randomCall),
    now: () => new Date("2026-08-07T12:00:00Z"),
    nowMs: () => milliseconds,
    sleep: async (duration) => {
      milliseconds += duration;
    },
  });

  assert.deepEqual(result, {
    ok: true,
    taskId,
    channelId,
    status: "completed",
    version: 2,
    progress: 100,
  });
  const taskReads = api.calls.filter(
    (call) => call.url.pathname === "/rest/v1/action_tasks",
  );
  assert.equal(taskReads.length, 2);
  assert.match(taskReads[0].headers.Authorization, /^Bearer mobile-access$/);
  assert.equal(
    api.calls.filter((call) => call.method === "DELETE").length,
    4,
  );
});

test("e2e runner cleans up users, channel and image after a webhook failure", async () => {
  const api = createFakeApi({ failWebhook: true });
  await assert.rejects(
    runCtrl2PhoneE2e(config, {
      fetchImpl: api.fetchImpl,
      randomBytes: () => Buffer.alloc(32, 7),
      now: () => new Date("2026-08-07T12:00:00Z"),
    }),
    /dispatch_action_webhook_failed_500/,
  );
  assert.equal(
    api.calls.filter((call) => call.method === "DELETE").length,
    4,
  );
});
