# Ctrl2Phone n8n runtime

This folder pins the local n8n version used by the desktop action workflows.
The mobile app never receives the n8n URL, webhook secret, Gemini key, or
Supabase service-role key.

## Local setup

1. Copy `.env.example` to `.env`.
2. Generate `N8N_ENCRYPTION_KEY` and `CTRL2PHONE_WEBHOOK_SECRET` independently:

   `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`

3. Put the Supabase project URL and a server-only `sb_secret_...` key in `.env`.
4. Run `npm install`, `npm run validate`, and then `npm start`.
5. In a second terminal run `npm run healthcheck`.

## Action workflows

The router and all three specialist workflows are imported inactive on purpose.
Before activating the router:

1. Create an n8n **Header Auth** credential named `Ctrl2Phone Webhook Secret`.
2. Set its header name to `x-ctrl2phone-secret` and its value to the same
   `CTRL2PHONE_WEBHOOK_SECRET` used in `.env` and the desktop Action settings.
3. Create an n8n **Supabase API** credential named
   `Ctrl2Phone Supabase Service Role`. Enter the project URL and the server-only
   service-role key. Never use the anon/publishable key for this credential.
4. Create another **Header Auth** credential named
   `Ctrl2Phone Gemini API Key`. Set its header name to `x-goog-api-key` and its
   value to the same Gemini key stored by Ctrl2Phone.
5. After importing, replace the public
   `https://REPLACE_PROJECT_REF.supabase.co` origin in each specialist workflow
   with the real Supabase project origin. Keep the storage and RPC paths
   unchanged.
6. Import these files and select the credentials above wherever an imported
   placeholder is shown:
   - `ctrl2phone-profile-specialist.json`
   - `ctrl2phone-recipe-specialist.json`
   - `ctrl2phone-general-specialist.json`
   - `ctrl2phone-intent-router.json`
7. Save the specialist workflows, then save and activate only the intent router.
8. Run `npm run build:workflows`, `npm run validate:workflows`, and `npm test`
   after every checked-in workflow change.

## Live end-to-end verification

After the generated Supabase SQL is applied, Anonymous Sign-Ins are enabled,
all four workflows are imported with their credentials, and the router is
active, run:

`npm run e2e`

The check creates two temporary anonymous users to exercise the real desktop
owner/mobile-member boundary, consumes a one-time channel invite, uploads a
small private PNG, enqueues and dispatches a task, waits for a completed n8n
result, and verifies the mobile read/pin RPC. It then removes the image,
channel/tasks, and both temporary users even when the workflow fails. The
service-role and webhook secrets are never printed. Set
`CTRL2PHONE_E2E_IMAGE_PATH` to test with a specific safe PNG; otherwise the
built-in one-pixel fixture is used.

The router returns HTTP `202` before starting exactly one specialist
sub-workflow. Every specialist advances `action_tasks` with an optimistic
`expected_version`; stale or duplicate executions fail instead of overwriting a
newer result. The profile route alone moves through `researching` and uses
Google Search grounding. Recipe and general analysis do not perform public web
research. Version-changing RPC nodes are intentionally not auto-retried because
a lost HTTP response could otherwise repeat a transition that already committed;
the read-only image download and Gemini request retain bounded retries.

The desktop performs Gemini structured intent classification locally with the
API key already stored by Ctrl2Phone. The key is sent to Google only in the
`x-goog-api-key` request header; it is never placed in the n8n webhook body or
URL. n8n receives only the validated route result and private Supabase object
metadata. Each specialist downloads the PNG from the fixed private bucket with
the encrypted Supabase credential, calls Gemini with the encrypted Header Auth
credential, and writes the structured result back to the task row. The profile
prompt permits only public identifiers visibly written in the screenshot; it
forbids face identification, sensitive-trait inference, private contact data,
and unsupported account guesses.

The checked-in example contains placeholders only. Real secrets, the local n8n
database, and execution data are ignored by Git. The service-role key bypasses
RLS and must remain inside this server-side runtime.

## Security boundary

The checked-in starter binds n8n to loopback only, disables its public API and
community packages, enables SSRF protection, blocks workflow access to process
environment variables, and loads only the small node allowlist needed by this
project. Do not change `N8N_LISTEN_ADDRESS` to `0.0.0.0` and do not expose port
5678 to the internet. Use a maintained n8n Cloud/reverse-proxy deployment if a
remote webhook is required.

At the time this runtime was pinned, `npm audit --omit=dev` reports unresolved
high/critical advisories in n8n's upstream transitive dependency tree. A normal
`npm audit fix` cannot remove them; `--force` proposes a breaking downgrade.
The local-only/node-allowlist controls reduce exposure but do not erase that
vendor risk. Re-run the audit whenever n8n is upgraded, and never use
`npm audit fix --force` without a reviewed compatibility migration.

## Supabase prerequisite

Enable anonymous sign-ins in Supabase Auth. Run Ctrl2Phone's generated
"Supabase security setup" SQL once in the Supabase SQL Editor. The SQL creates
the authenticated pairing channel and one-time claim functions used by later
desktop/mobile phases.
