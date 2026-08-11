import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readIntegrationConfig } from "../src/config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = readIntegrationConfig();

const credentials = [
  {
    id: "REPLACE_WITH_N8N_HEADER_AUTH_CREDENTIAL_ID",
    name: "Ctrl2Phone Webhook Secret",
    type: "httpHeaderAuth",
    data: {
      name: "x-ctrl2phone-secret",
      value: config.webhookSecret,
    },
  },
  {
    id: "REPLACE_WITH_N8N_SUPABASE_CREDENTIAL_ID",
    name: "Ctrl2Phone Supabase Service Role",
    type: "supabaseApi",
    data: {
      host: config.supabaseUrl,
      serviceRole: config.serviceRoleKey,
    },
  },
  {
    id: "REPLACE_WITH_N8N_GEMINI_HEADER_AUTH_CREDENTIAL_ID",
    name: "Ctrl2Phone Gemini API Key",
    type: "httpHeaderAuth",
    data: {
      name: "x-goog-api-key",
      value: process.env.GEMINI_API_KEY?.trim() || "test-gemini-api-key",
    },
  },
];

const tmpDir = resolve(__dirname, "../tmp");
await mkdir(tmpDir, { recursive: true });
const credFile = resolve(tmpDir, "credentials.json");
await writeFile(credFile, JSON.stringify(credentials, null, 2), "utf8");
console.log("Wrote credentials.json to", credFile);
