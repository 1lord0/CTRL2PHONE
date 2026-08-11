const healthUrl =
  process.env.N8N_HEALTH_URL?.trim() || "http://127.0.0.1:5678/healthz";
const url = new URL(healthUrl);
if (url.protocol !== "http:" && url.protocol !== "https:") {
  throw new Error("N8N_HEALTH_URL_invalid");
}

const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
if (!response.ok) {
  throw new Error(`n8n_healthcheck_failed_${response.status}`);
}

console.log(
  JSON.stringify({ ok: true, status: response.status, origin: url.origin }),
);
