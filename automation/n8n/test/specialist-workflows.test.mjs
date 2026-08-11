import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildAllSpecialistWorkflows,
  SPECIALIST_WORKFLOWS,
} from "../src/specialist-workflows.mjs";
import { validateSpecialistWorkflow } from "../src/workflow-validator.mjs";

const filenames = Object.freeze({
  profile_research: "ctrl2phone-profile-specialist.json",
  recipe_extraction: "ctrl2phone-recipe-specialist.json",
  general_visual_analysis: "ctrl2phone-general-specialist.json",
});

const checkedWorkflows = {};
for (const [route, filename] of Object.entries(filenames)) {
  checkedWorkflows[route] = JSON.parse(
    await readFile(
      fileURLToPath(new URL(`../workflows/${filename}`, import.meta.url)),
      "utf8",
    ),
  );
}

test("checked specialist files are deterministic builder output", () => {
  assert.deepEqual(checkedWorkflows, buildAllSpecialistWorkflows());
});

test("all generated n8n expressions are valid JavaScript expressions", () => {
  for (const workflow of Object.values(checkedWorkflows)) {
    for (const node of workflow.nodes) {
      for (const value of [node.parameters?.url, node.parameters?.jsonBody]) {
        if (typeof value !== "string" || !value.startsWith("={{")) continue;
        const source = value.slice(3, -2).trim();
        assert.doesNotThrow(
          () => new Function("$json", "$binary", "$", `return (${source});`),
          `${workflow.id}:${node.name}`,
        );
      }
    }
  }
});

for (const route of Object.keys(SPECIALIST_WORKFLOWS)) {
  test(`${route} passes the hardened specialist contract`, () => {
    const result = validateSpecialistWorkflow(checkedWorkflows[route], route);
    assert.equal(result.ok, true);
    assert.equal(result.id, SPECIALIST_WORKFLOWS[route].id);
  });
}

test("rejects a service-role key embedded in a workflow", () => {
  const changed = structuredClone(checkedWorkflows.recipe_extraction);
  changed.nodes.find((node) => node.name === "Mark Analyzing").parameters.note =
    `sb_secret_${"s".repeat(32)}`;
  assert.throws(
    () => validateSpecialistWorkflow(changed, "recipe_extraction"),
    /forbidden_value:sb_secret_/,
  );
});

test("rejects a dynamic private-download host", () => {
  const changed = structuredClone(checkedWorkflows.general_visual_analysis);
  changed.nodes.find(
    (node) => node.name === "Download Private Image",
  ).parameters.url =
    "={{ $json.untrustedHost + '/storage/v1/object/authenticated/' }}";
  assert.throws(
    () => validateSpecialistWorkflow(changed, "general_visual_analysis"),
    /private_download_contract/,
  );
});

test("rejects a Gemini key placed in the query string", () => {
  const changed = structuredClone(checkedWorkflows.recipe_extraction);
  changed.nodes.find(
    (node) => node.name === "Gemini recipe_extraction",
  ).parameters.url += "?key=GEMINI_API_KEY";
  assert.throws(
    () => validateSpecialistWorkflow(changed, "recipe_extraction"),
    /forbidden_value:GEMINI_API_KEY/,
  );
});

test("rejects a completion write with a stale optimistic version", () => {
  const changed = structuredClone(checkedWorkflows.profile_research);
  const completed = changed.nodes.find(
    (node) => node.name === "Mark Completed",
  );
  completed.parameters.jsonBody = completed.parameters.jsonBody.replace(
    "p_expected_version: 2",
    "p_expected_version: 1",
  );
  assert.throws(
    () => validateSpecialistWorkflow(changed, "profile_research"),
    /transition_marker_missing/,
  );
});

test("rejects automatic retries on version-changing task transitions", () => {
  const changed = structuredClone(checkedWorkflows.recipe_extraction);
  changed.nodes.find((node) => node.name === "Mark Completed").retryOnFail =
    true;
  assert.throws(
    () => validateSpecialistWorkflow(changed, "recipe_extraction"),
    /transition_must_not_retry/,
  );
});

test("Google Search grounding is limited to public profile research", () => {
  assert.match(
    checkedWorkflows.profile_research.nodes.find(
      (node) => node.name === "Gemini profile_research",
    ).parameters.jsonBody,
    /googleSearch/,
  );
  for (const route of ["recipe_extraction", "general_visual_analysis"]) {
    assert.doesNotMatch(
      checkedWorkflows[route].nodes.find(
        (node) => node.name === `Gemini ${route}`,
      ).parameters.jsonBody,
      /googleSearch/,
    );
  }
});
