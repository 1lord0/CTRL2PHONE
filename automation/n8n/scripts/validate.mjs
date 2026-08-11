import { readIntegrationConfig } from "../src/config.mjs";

const config = readIntegrationConfig();
console.log(
  JSON.stringify({
    ok: true,
    n8n: `${config.protocol}://${config.host}:${config.port}`,
    supabaseOrigin: config.supabaseUrl,
    secretsLoaded: true,
  }),
);
