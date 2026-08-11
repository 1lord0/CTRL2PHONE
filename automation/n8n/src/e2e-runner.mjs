import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import { readFile as nodeReadFile } from "node:fs/promises";

const ACTION_BUCKET = "ctrl2phone-action-inputs";
const DEFAULT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=",
  "base64",
);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function safeBody(value) {
  return String(value ?? "")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[JWT]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .slice(0, 1000);
}

async function requestJson(fetchImpl, name, url, options, expectedStatuses) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(`${name}_network_failed: ${safeBody(error?.message ?? error)}`);
  }
  const text = await response.text();
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`${name}_failed_${response.status}: ${safeBody(text)}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name}_invalid_json`);
  }
}

function authHeaders(key, accessToken, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${accessToken}`,
    ...extra,
  };
}

function validatePng(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length < signature.length ||
    buffer.length > 15 * 1024 * 1024 ||
    !buffer.subarray(0, signature.length).equals(signature)
  ) {
    throw new Error("CTRL2PHONE_E2E_IMAGE_PATH_not_png");
  }
}

function parseSession(value, name) {
  const accessToken = value?.access_token;
  const userId = value?.user?.id;
  if (typeof accessToken !== "string" || !UUID.test(userId ?? "")) {
    throw new Error(`${name}_invalid_session`);
  }
  return { accessToken, userId };
}

function taskUrl(supabaseUrl, taskId, channelId) {
  const url = new URL("/rest/v1/action_tasks", supabaseUrl);
  url.searchParams.set(
    "select",
    "id,channel_id,intent_type,workflow_status,progress,title,summary,result_json,sources,confidence,error_code,error_message,version,updated_at,completed_at",
  );
  url.searchParams.set("id", `eq.${taskId}`);
  url.searchParams.set("channel_id", `eq.${channelId}`);
  return url;
}

function validateTaskRow(value, expected) {
  if (
    !value ||
    value.id !== expected.taskId ||
    value.channel_id !== expected.channelId ||
    !Number.isSafeInteger(Number(value.version)) ||
    Number(value.version) < 0 ||
    !Number.isSafeInteger(Number(value.progress)) ||
    Number(value.progress) < 0 ||
    Number(value.progress) > 100 ||
    typeof value.workflow_status !== "string"
  ) {
    throw new Error("e2e_task_row_invalid");
  }
  return value;
}

async function deleteIgnoringNotFound(fetchImpl, name, url, options) {
  await requestJson(fetchImpl, name, url, options, [200, 204, 404]);
}

export async function runCtrl2PhoneE2e(
  config,
  {
    fetchImpl = fetch,
    readFile = nodeReadFile,
    randomBytes = nodeRandomBytes,
    now = () => new Date(),
    nowMs = () => Date.now(),
    sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {},
) {
  const image = config.imagePath ? await readFile(config.imagePath) : DEFAULT_PNG;
  validatePng(image);

  const supabaseUrl = new URL(config.supabaseUrl).origin;
  const serviceHeaders = authHeaders(
    config.serviceRoleKey,
    config.serviceRoleKey,
    { "Content-Type": "application/json" },
  );
  let owner = null;
  let mobile = null;
  let channelId = null;
  let objectPath = null;
  let primaryError = null;
  let outcome = null;
  const cleanupFailures = [];

  try {
    const signUpUrl = new URL("/auth/v1/signup", supabaseUrl);
    owner = parseSession(
      await requestJson(
        fetchImpl,
        "owner_anonymous_sign_in",
        signUpUrl,
        {
          method: "POST",
          headers: authHeaders(config.anonKey, config.anonKey, {
            "Content-Type": "application/json",
          }),
          body: "{}",
        },
        [200],
      ),
      "owner",
    );
    mobile = parseSession(
      await requestJson(
        fetchImpl,
        "mobile_anonymous_sign_in",
        signUpUrl,
        {
          method: "POST",
          headers: authHeaders(config.anonKey, config.anonKey, {
            "Content-Type": "application/json",
          }),
          body: "{}",
        },
        [200],
      ),
      "mobile",
    );

    const inviteToken = randomBytes(32).toString("base64url");
    const inviteExpiresAt = new Date(now().getTime() + 10 * 60_000).toISOString();
    channelId = await requestJson(
      fetchImpl,
      "create_action_channel",
      new URL("/rest/v1/rpc/create_action_channel", supabaseUrl),
      {
        method: "POST",
        headers: authHeaders(config.anonKey, owner.accessToken, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          p_name: "Ctrl2Phone E2E",
          p_invite_token: inviteToken,
          p_invite_expires_at: inviteExpiresAt,
        }),
      },
      [200],
    );
    if (!UUID.test(channelId ?? "")) throw new Error("e2e_channel_id_invalid");

    const claimed = await requestJson(
      fetchImpl,
      "claim_action_channel",
      new URL("/rest/v1/rpc/claim_action_channel", supabaseUrl),
      {
        method: "POST",
        headers: authHeaders(config.anonKey, mobile.accessToken, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          p_channel_id: channelId,
          p_invite_token: inviteToken,
        }),
      },
      [200],
    );
    if (claimed !== channelId) throw new Error("e2e_channel_claim_mismatch");

    const sourceSha256 = createHash("sha256").update(image).digest("hex");
    const idempotencyKey = `act_${randomBytes(32).toString("hex")}`;
    const requestHash = createHash("sha256")
      .update(`ctrl2phone-e2e-v1\0${sourceSha256}\0${idempotencyKey}`)
      .digest("hex");
    objectPath = `${channelId}/${idempotencyKey}.png`;
    const storageUrl = new URL(
      `/storage/v1/object/${ACTION_BUCKET}/${objectPath}`,
      supabaseUrl,
    );
    await requestJson(
      fetchImpl,
      "upload_action_input",
      storageUrl,
      {
        method: "POST",
        headers: authHeaders(config.anonKey, owner.accessToken, {
          "Content-Type": "image/png",
          "x-upsert": "false",
        }),
        body: image,
      },
      [200],
    );

    const taskResponse = await requestJson(
      fetchImpl,
      "enqueue_action_task",
      new URL("/rest/v1/rpc/enqueue_action_task", supabaseUrl),
      {
        method: "POST",
        headers: authHeaders(config.anonKey, owner.accessToken, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          p_channel_id: channelId,
          p_idempotency_key: idempotencyKey,
          p_request_hash: requestHash,
          p_source_device_id: "ctrl2phone-e2e",
          p_source_storage_path: objectPath,
          p_title: "Ctrl2Phone E2E görsel analizi",
        }),
      },
      [200],
    );
    const taskId = typeof taskResponse === "string" ? taskResponse : taskResponse?.id;
    if (!UUID.test(taskId ?? "")) throw new Error("e2e_task_id_invalid");

    const webhookResponse = await requestJson(
      fetchImpl,
      "dispatch_action_webhook",
      new URL(config.webhookUrl),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-ctrl2phone-secret": config.webhookSecret,
        },
        body: JSON.stringify({
          schemaVersion: 1,
          taskId,
          channelId,
          idempotencyKey,
          requestHash,
          expectedVersion: 0,
          intentAnalysis: {
            intentType: "general_visual_analysis",
            confidence: 1,
            title: "Ctrl2Phone E2E görsel analizi",
            rationale: "Controlled end-to-end integration verification.",
            searchQueries: [],
            visibleText: [],
          },
          source: {
            bucket: ACTION_BUCKET,
            objectPath,
            mimeType: "image/png",
            byteLength: image.length,
            sha256: sourceSha256,
          },
        }),
      },
      [202],
    );
    if (webhookResponse?.accepted !== true || webhookResponse.taskId !== taskId) {
      throw new Error("e2e_webhook_ack_invalid");
    }

    const deadline = nowMs() + config.timeoutMs;
    let lastVersion = -1;
    let lastProgress = -1;
    let finalTask = null;
    while (nowMs() < deadline) {
      const rows = await requestJson(
        fetchImpl,
        "read_mobile_action_task",
        taskUrl(supabaseUrl, taskId, channelId),
        {
          method: "GET",
          headers: authHeaders(config.anonKey, mobile.accessToken),
        },
        [200],
      );
      if (!Array.isArray(rows) || rows.length > 1) {
        throw new Error("e2e_task_query_invalid");
      }
      if (rows.length === 1) {
        const task = validateTaskRow(rows[0], { taskId, channelId });
        const version = Number(task.version);
        const progress = Number(task.progress);
        if (version < lastVersion || progress < lastProgress) {
          throw new Error("e2e_task_regressed");
        }
        lastVersion = version;
        lastProgress = progress;
        if (TERMINAL.has(task.workflow_status)) {
          finalTask = task;
          break;
        }
      }
      await sleep(2000);
    }
    if (!finalTask) throw new Error("e2e_task_timeout");
    if (finalTask.workflow_status !== "completed") {
      throw new Error(
        `e2e_workflow_${finalTask.workflow_status}: ${safeBody(finalTask.error_code)} ${safeBody(finalTask.error_message)}`,
      );
    }
    if (
      Number(finalTask.progress) !== 100 ||
      typeof finalTask.result_json !== "object" ||
      finalTask.result_json === null ||
      !Array.isArray(finalTask.sources)
    ) {
      throw new Error("e2e_completed_result_invalid");
    }

    const state = await requestJson(
      fetchImpl,
      "set_mobile_task_state",
      new URL("/rest/v1/rpc/set_action_task_user_state", supabaseUrl),
      {
        method: "POST",
        headers: authHeaders(config.anonKey, mobile.accessToken, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          p_task_id: taskId,
          p_is_read: true,
          p_is_pinned: true,
          p_is_archived: false,
        }),
      },
      [200],
    );
    const stateRow = Array.isArray(state) ? state[0] : state;
    if (stateRow?.task_id !== taskId || !stateRow.read_at || !stateRow.pinned_at) {
      throw new Error("e2e_mobile_task_state_invalid");
    }

    outcome = Object.freeze({
      ok: true,
      taskId,
      channelId,
      status: finalTask.workflow_status,
      version: Number(finalTask.version),
      progress: Number(finalTask.progress),
    });
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanup = async (name, operation) => {
      try {
        await operation();
      } catch (error) {
        cleanupFailures.push(`${name}: ${safeBody(error?.message ?? error)}`);
      }
    };
    if (objectPath) {
      await cleanup("storage", () =>
        deleteIgnoringNotFound(
          fetchImpl,
          "cleanup_storage",
          new URL(`/storage/v1/object/${ACTION_BUCKET}/${objectPath}`, supabaseUrl),
          {
            method: "DELETE",
            headers: authHeaders(config.serviceRoleKey, config.serviceRoleKey),
          },
        ),
      );
    }
    if (channelId) {
      const channelUrl = new URL("/rest/v1/action_channels", supabaseUrl);
      channelUrl.searchParams.set("id", `eq.${channelId}`);
      await cleanup("channel", () =>
        deleteIgnoringNotFound(fetchImpl, "cleanup_channel", channelUrl, {
          method: "DELETE",
          headers: { ...serviceHeaders, Prefer: "return=minimal" },
        }),
      );
    }
    for (const [label, session] of [
      ["owner", owner],
      ["mobile", mobile],
    ]) {
      if (!session) continue;
      await cleanup(label, () =>
        deleteIgnoringNotFound(
          fetchImpl,
          `cleanup_${label}_user`,
          new URL(`/auth/v1/admin/users/${session.userId}`, supabaseUrl),
          { method: "DELETE", headers: serviceHeaders },
        ),
      );
    }
  }

  if (primaryError) {
    if (cleanupFailures.length) {
      primaryError.message = `${primaryError.message}\ncleanup: ${cleanupFailures.join("; ")}`;
    }
    throw primaryError;
  }
  if (cleanupFailures.length) {
    throw new Error(`e2e_cleanup_failed: ${cleanupFailures.join("; ")}`);
  }
  return outcome;
}
