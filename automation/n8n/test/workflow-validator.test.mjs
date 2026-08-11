import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateIntentRouterWorkflow } from "../src/workflow-validator.mjs";

const workflow = JSON.parse(
  await readFile(
    fileURLToPath(
      new URL("../workflows/ctrl2phone-intent-router.json", import.meta.url),
    ),
    "utf8",
  ),
);

test("checked-in intent router passes the hardened workflow contract", () => {
  const result = validateIntentRouterWorkflow(workflow);
  assert.equal(result.ok, true);
  assert.deepEqual(
    [...result.routes],
    ["profile_research", "recipe_extraction", "general_visual_analysis"],
  );
});

test("rejects unauthenticated webhooks", () => {
  const changed = structuredClone(workflow);
  changed.nodes.find(
    (node) => node.name === "Action Webhook",
  ).parameters.authentication = "none";
  assert.throws(
    () => validateIntentRouterWorkflow(changed),
    /webhook_security_contract/,
  );
});

test("rejects dangerous nodes even if they are disconnected", () => {
  const changed = structuredClone(workflow);
  changed.nodes.push({
    name: "Shell",
    type: "n8n-nodes-base.executeCommand",
    parameters: {},
  });
  assert.throws(
    () => validateIntentRouterWorkflow(changed),
    /node_not_allowed/,
  );
});

test("rejects a router that silently drops a supported route", () => {
  const changed = structuredClone(workflow);
  changed.nodes.find(
    (node) => node.name === "Intent Router",
  ).parameters.output = "={{ 0 }}";
  assert.throws(
    () => validateIntentRouterWorkflow(changed),
    /router_route_missing/,
  );
});

test("rejects synchronous specialist dispatch that can delay the webhook", () => {
  const changed = structuredClone(workflow);
  changed.nodes.find(
    (node) => node.name === "Run Profile Specialist",
  ).parameters.options.waitForSubWorkflow = true;
  assert.throws(
    () => validateIntentRouterWorkflow(changed),
    /specialist_dispatch_invalid/,
  );
});
