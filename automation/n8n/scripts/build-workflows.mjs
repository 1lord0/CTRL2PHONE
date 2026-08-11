import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildAllSpecialistWorkflows } from "../src/specialist-workflows.mjs";

const outputNames = Object.freeze({
  profile_research: "ctrl2phone-profile-specialist.json",
  recipe_extraction: "ctrl2phone-recipe-specialist.json",
  general_visual_analysis: "ctrl2phone-general-specialist.json",
});

const targetOrigin = process.env.SUPABASE_URL
  ? new URL(process.env.SUPABASE_URL).origin
  : undefined;

for (const [route, workflow] of Object.entries(buildAllSpecialistWorkflows(targetOrigin))) {
  const outputUrl = new URL(
    `../workflows/${outputNames[route]}`,
    import.meta.url,
  );
  await writeFile(
    fileURLToPath(outputUrl),
    `${JSON.stringify(workflow, null, 2)}\n`,
    "utf8",
  );
}

console.log(
  `Generated ${Object.keys(outputNames).length} specialist workflows.`,
);
