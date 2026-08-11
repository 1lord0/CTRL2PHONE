import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  validateIntentRouterWorkflow,
  validateSpecialistWorkflow,
} from "../src/workflow-validator.mjs";

const workflows = [
  ["router", "ctrl2phone-intent-router.json"],
  ["profile_research", "ctrl2phone-profile-specialist.json"],
  ["recipe_extraction", "ctrl2phone-recipe-specialist.json"],
  ["general_visual_analysis", "ctrl2phone-general-specialist.json"],
];

const results = [];
for (const [route, filename] of workflows) {
  const workflowUrl = new URL(`../workflows/${filename}`, import.meta.url);
  const workflow = JSON.parse(
    await readFile(fileURLToPath(workflowUrl), "utf8"),
  );
  results.push(
    route === "router"
      ? validateIntentRouterWorkflow(workflow)
      : validateSpecialistWorkflow(workflow, route),
  );
}

console.log(JSON.stringify({ ok: true, workflows: results }));
