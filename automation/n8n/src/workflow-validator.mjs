import { SAFE_N8N_NODES } from "./config.mjs";
import {
  SPECIALIST_WORKFLOWS,
  SUPABASE_ORIGIN,
} from "./specialist-workflows.mjs";

const REQUIRED_ROUTES = Object.freeze([
  "profile_research",
  "recipe_extraction",
  "general_visual_analysis",
]);

const ROUTE_NODES = Object.freeze({
  profile_research: "Run Profile Specialist",
  recipe_extraction: "Run Recipe Specialist",
  general_visual_analysis: "Run General Specialist",
});

function fail(message) {
  throw new Error(`workflow_invalid:${message}`);
}

function nodeByName(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  if (!node) fail(`node_missing:${name}`);
  return node;
}

function assertAllowedNodes(workflow) {
  const allowed = new Set(SAFE_N8N_NODES);
  for (const node of workflow.nodes) {
    if (!allowed.has(node.type)) fail(`node_not_allowed:${node.type}`);
  }
}

function assertNoEmbeddedSecrets(workflow) {
  const serialized = JSON.stringify(workflow);
  for (const forbidden of [
    "SUPABASE_SERVICE_ROLE_KEY",
    "GEMINI_API_KEY",
    "CTRL2PHONE_WEBHOOK_SECRET=",
    "sb_secret_",
    "service_role",
    "?key=",
    "n8n-nodes-base.code",
    "n8n-nodes-base.executeCommand",
    "n8n-nodes-base.readWriteFile",
  ]) {
    if (serialized.includes(forbidden)) fail(`forbidden_value:${forbidden}`);
  }
}

function assertDirectConnection(workflow, from, to) {
  const outputs = workflow.connections?.[from]?.main;
  if (
    !Array.isArray(outputs) ||
    outputs.length !== 1 ||
    outputs[0]?.length !== 1 ||
    outputs[0][0]?.node !== to
  ) {
    fail(`connection_invalid:${from}:${to}`);
  }
}

export function validateIntentRouterWorkflow(workflow) {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow))
    fail("root");
  if (typeof workflow.id !== "string" || !workflow.id) fail("id");
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length < 8)
    fail("nodes");
  if (workflow.active !== false) fail("must_import_inactive");

  assertAllowedNodes(workflow);

  const webhook = nodeByName(workflow, "Action Webhook");
  if (
    webhook.type !== "n8n-nodes-base.webhook" ||
    webhook.parameters?.httpMethod !== "POST" ||
    webhook.parameters?.path !== "ctrl2phone-action" ||
    webhook.parameters?.authentication !== "headerAuth" ||
    webhook.parameters?.responseMode !== "responseNode"
  ) {
    fail("webhook_security_contract");
  }
  const headerCredential = webhook.credentials?.httpHeaderAuth;
  if (
    headerCredential?.name !== "Ctrl2Phone Webhook Secret" ||
    typeof headerCredential?.id !== "string"
  ) {
    fail("webhook_credential_reference");
  }

  const gate = nodeByName(workflow, "Contract Gate");
  const gateExpression = String(gate.parameters?.output ?? "");
  for (const marker of [
    "schemaVersion",
    "taskId",
    "channelId",
    "idempotencyKey",
    "requestHash",
    "expectedVersion",
    "ctrl2phone-action-inputs",
    "15728640",
    "intentAnalysis",
  ]) {
    if (!gateExpression.includes(marker))
      fail(`contract_marker_missing:${marker}`);
  }

  const accepted = nodeByName(workflow, "Accepted 202");
  const rejected = nodeByName(workflow, "Rejected 400");
  if (accepted.parameters?.options?.responseCode !== 202)
    fail("accepted_response");
  if (rejected.parameters?.options?.responseCode !== 400)
    fail("rejected_response");

  const router = nodeByName(workflow, "Intent Router");
  if (router.parameters?.numberOutputs !== REQUIRED_ROUTES.length)
    fail("router_output_count");
  const routerExpression = String(router.parameters?.output ?? "");
  for (const route of REQUIRED_ROUTES) {
    if (!routerExpression.includes(route))
      fail(`router_route_missing:${route}`);

    const routeNode = nodeByName(workflow, ROUTE_NODES[route]);
    if (
      routeNode.type !== "n8n-nodes-base.executeWorkflow" ||
      routeNode.typeVersion !== 1 ||
      routeNode.parameters?.source !== "database" ||
      routeNode.parameters?.workflowId !== SPECIALIST_WORKFLOWS[route].id ||
      routeNode.parameters?.mode !== "once" ||
      routeNode.parameters?.options?.waitForSubWorkflow !== false
    ) {
      fail(`specialist_dispatch_invalid:${route}`);
    }
  }
  const routedOutputs = workflow.connections?.[router.name]?.main;
  if (
    !Array.isArray(routedOutputs) ||
    routedOutputs.length !== REQUIRED_ROUTES.length ||
    REQUIRED_ROUTES.some(
      (route, index) =>
        routedOutputs[index]?.length !== 1 ||
        routedOutputs[index][0]?.node !== ROUTE_NODES[route],
    )
  ) {
    fail("router_connections");
  }

  assertNoEmbeddedSecrets(workflow);

  return Object.freeze({
    ok: true,
    nodeCount: workflow.nodes.length,
    routes: REQUIRED_ROUTES,
  });
}

function assertSupabaseNode(node) {
  if (
    node.type !== "n8n-nodes-base.httpRequest" ||
    node.parameters?.authentication !== "predefinedCredentialType" ||
    node.parameters?.nodeCredentialType !== "supabaseApi" ||
    node.credentials?.supabaseApi?.name !==
      "Ctrl2Phone Supabase Service Role" ||
    typeof node.credentials?.supabaseApi?.id !== "string"
  ) {
    fail(`supabase_node_security:${node.name}`);
  }
}

function assertTransition(node, route, expectedVersion, status, progress) {
  assertSupabaseNode(node);
  if (node.retryOnFail === true) {
    fail(`transition_must_not_retry:${node.name}`);
  }
  if (
    node.parameters?.url !==
    `${SUPABASE_ORIGIN}/rest/v1/rpc/advance_action_task`
  ) {
    fail(`transition_rpc_url:${node.name}`);
  }
  const body = String(node.parameters?.jsonBody ?? "");
  for (const marker of [
    "p_task_id",
    `p_expected_version: ${expectedVersion}`,
    `p_next_status: '${status}'`,
    `p_progress: ${progress}`,
    `p_intent_type: '${route}'`,
  ]) {
    if (!body.includes(marker))
      fail(`transition_marker_missing:${node.name}:${marker}`);
  }
}

export function validateSpecialistWorkflow(workflow, route) {
  const definition = SPECIALIST_WORKFLOWS[route];
  if (!definition) fail(`unknown_specialist_route:${route}`);
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow))
    fail("root");
  if (workflow.id !== definition.id) fail(`specialist_id:${route}`);
  if (workflow.active !== false) fail("must_import_inactive");
  if (!Array.isArray(workflow.nodes)) fail("nodes");
  if (workflow.nodes.length !== (definition.researching ? 6 : 5))
    fail(`specialist_node_count:${route}`);
  assertAllowedNodes(workflow);
  assertNoEmbeddedSecrets(workflow);

  const trigger = nodeByName(workflow, "When Executed by Another Workflow");
  if (
    trigger.type !== "n8n-nodes-base.executeWorkflowTrigger" ||
    trigger.parameters?.inputSource !== "passthrough"
  ) {
    fail(`specialist_trigger:${route}`);
  }

  const analyzing = nodeByName(workflow, "Mark Analyzing");
  assertTransition(analyzing, route, 0, "analyzing", 10);
  let previous = analyzing.name;
  let completionVersion = 1;
  assertDirectConnection(workflow, trigger.name, analyzing.name);

  if (definition.researching) {
    const researching = nodeByName(workflow, "Mark Researching");
    assertTransition(researching, route, 1, "researching", 35);
    assertDirectConnection(workflow, previous, researching.name);
    previous = researching.name;
    completionVersion = 2;
  }

  const download = nodeByName(workflow, "Download Private Image");
  assertSupabaseNode(download);
  const downloadUrl = String(download.parameters?.url ?? "");
  if (
    !downloadUrl.includes(
      `${SUPABASE_ORIGIN}/storage/v1/object/authenticated/`,
    ) ||
    !downloadUrl.includes("source.bucket") ||
    !downloadUrl.includes("source.objectPath") ||
    download.parameters?.options?.response?.response?.responseFormat !==
      "file" ||
    download.parameters?.options?.response?.response?.outputPropertyName !==
      "sourceImage" ||
    download.retryOnFail !== true ||
    download.maxTries !== 3
  ) {
    fail(`private_download_contract:${route}`);
  }
  assertDirectConnection(workflow, previous, download.name);

  const gemini = nodeByName(workflow, `Gemini ${route}`);
  if (
    gemini.type !== "n8n-nodes-base.httpRequest" ||
    gemini.parameters?.url !==
      `https://generativelanguage.googleapis.com/v1beta/models/${definition.model}:generateContent` ||
    gemini.parameters?.authentication !== "genericCredentialType" ||
    gemini.parameters?.genericAuthType !== "httpHeaderAuth" ||
    gemini.credentials?.httpHeaderAuth?.name !== "Ctrl2Phone Gemini API Key" ||
    typeof gemini.credentials?.httpHeaderAuth?.id !== "string" ||
    gemini.retryOnFail !== true ||
    gemini.maxTries !== 3
  ) {
    fail(`gemini_security_contract:${route}`);
  }
  const geminiBody = String(gemini.parameters?.jsonBody ?? "");
  for (const marker of [
    "$binary.sourceImage.data",
    "inlineData",
    "image/png",
    "responseMimeType",
    "application/json",
  ]) {
    if (!geminiBody.includes(marker))
      fail(`gemini_marker_missing:${route}:${marker}`);
  }
  if (geminiBody.includes("googleSearch") !== definition.useGoogleSearch) {
    fail(`google_search_policy:${route}`);
  }
  assertDirectConnection(workflow, download.name, gemini.name);

  const completed = nodeByName(workflow, "Mark Completed");
  assertTransition(completed, route, completionVersion, "completed", 100);
  const completionBody = String(completed.parameters?.jsonBody ?? "");
  for (const marker of [
    "JSON.parse",
    "p_result_json",
    "p_sources",
    "p_confidence",
    "slice(0, 20000)",
  ]) {
    if (!completionBody.includes(marker))
      fail(`completion_marker_missing:${route}:${marker}`);
  }
  assertDirectConnection(workflow, gemini.name, completed.name);

  return Object.freeze({
    ok: true,
    id: workflow.id,
    nodeCount: workflow.nodes.length,
    route,
  });
}
