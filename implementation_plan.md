---
handoff_version: 1
status: ready
executor: antigravity
created_by: codex
updated_at: 2026-08-06T12:35:54+03:00
---

# Objective

Fix the confirmed desktop, mobile, Supabase, release, and maintainability defects in
Ctrl2Phone through a strictly serial, phase-gated workflow. Preserve existing user-facing
behavior unless a phase explicitly changes a broken contract. Prevent overlapping sync,
shutdown, cleanup, test, edit, and Codebase Memory indexing operations.

Codebase Memory is the structural source of truth for dependency discovery between phases.
The current baseline index is:

- Project: `C-Users-EREN-Desktop-CTRL2PHONE-main`
- Root: `C:/Users/EREN/Desktop/CTRL2PHONE-main`
- Status: `ready`
- Nodes: 2,090
- Edges: 4,723

# Current Behavior

1. Desktop phone-to-PC downloads validate `%TEMP%/ctrl2phone` before creating it, so a
   clean installation can reject every incoming phone image.
2. Desktop polling/realtime work can still be active while shutdown cleanup deletes the
   download directory. The predictable cleanup root is traversed without junction/reparse
   validation.
3. The generated Supabase setup SQL configures storage only. It does not create or secure
   the `clipboard_sync` table used by desktop and mobile clipboard features.
4. Mobile caches six-hour signed URLs and never replaces a known photo with a refreshed
   URL. Cached gallery and sync keys also survive logout or Supabase project/bucket changes.
5. The mobile Supabase key is stored in plain `SharedPreferences`.
6. Mobile storage usage and purge operations read at most 1,000 root files and 1,000
   `to_pc` files, so counts and deletion are incomplete above those limits.
7. `ocr_helper.cs` is not built or packaged, and its stdout contract disagrees with the
   TypeScript caller's output-file contract.
8. The current desktop verification has one failing Jest suite (2 failed tests out of 256)
   and `npm audit --omit=dev` reports two high-severity transitive vulnerabilities.
9. Mobile CI does not execute the existing Flutter tests. Release jobs bypass the complete
   test/audit gates. Android release uses the debug signing key; iOS is built with
   `--no-codesign`; Windows release signing is not configured.
10. `desktop/src/main.ts` remains a 1,171-line composition hotspot with 117 outbound graph
    relationships, increasing regression and lifecycle-coupling risk.

# Scope

In scope:

- Desktop phone-file download storage, synchronization serialization, and lifecycle teardown.
- Supabase clipboard schema/RLS setup and its documentation/tests.
- Mobile credential persistence, account identity, signed-URL cache lifecycle, pagination,
  purge, and associated tests.
- OCR fallback contract cleanup.
- Dependency remediation, CI verification, and release-signing configuration.
- A final behavior-preserving extraction of Electron adapters from `desktop/src/main.ts`.
- Full Codebase Memory reindex and structural review after every phase.

Out of scope:

- Changing the product's BYO-Supabase architecture.
- Introducing a hosted Ctrl2Phone backend or user-account service.
- Creating signing certificates, Apple provisioning profiles, Android keystores, or GitHub
  secrets on the user's behalf.
- Adding unrelated features or redesigning the UI.
- Parallel agents, parallel phase execution, or concurrent edits to the same repository.

# Implementation Tasks

## Phase 0 — Serial baseline and execution gate

1. Use a single executor only. Do not spawn subagents and do not run two mutation commands
   against the repository concurrently.
2. Confirm no product-code process is modifying files. The running Electron application may
   remain open for observation, but stop it before dependency installation, native rebuilds,
   packaging, or filesystem-lifecycle tests.
3. Capture the baseline without changing product code:
   - `desktop`: typecheck, lint, format check, serial Jest, production audit.
   - `mobile`: `flutter pub get`, analyze, and tests when Flutter is available.
4. Query Codebase Memory `index_status` and `get_architecture(aspects=["all"])` for the
   baseline project. Record the failing-test and audit baseline in the phase handoff notes.
5. Do not proceed to Phase 1 until no indexing job, npm command, Flutter command, Electron
   process, or native helper build is writing within the repository.

Phase 0 gate: this phase uses the existing `ready` index and does not require a second
baseline reindex unless discovery shows source changes since the recorded index.

## Phase 1 — Race-free desktop phone-to-PC downloads and teardown

Files:

- `desktop/src/main/phoneDownloadAsset.ts`
- `desktop/src/main/phoneFileSyncController.ts`
- `desktop/src/main/appLifecycleController.ts`
- `desktop/src/main.ts`
- `desktop/test/phoneDownloadAsset.test.ts`
- `desktop/test/phoneFileSyncController.test.ts`
- `desktop/test/appLifecycleController.test.ts`
- Add one integration test under `desktop/test/` dedicated to download/shutdown ordering.

Tasks:

1. Replace the predictable `%TEMP%/ctrl2phone` download root in `main.ts` with the existing
   randomized, owned `createPhoneDownloadAssetStore(app.getPath('temp'))` abstraction.
   Initialize it before phone sync setup and make all downloads await the same initialization
   promise. Do not validate a directory before the application has atomically created and
   taken ownership of it.
2. Route downloaded bytes through `PhoneDownloadAssetStore.write`, preserving exclusive
   `wx` creation and randomized local names. Remove the later `mkdirSync`/`writeFileSync`
   sequence from the download adapter.
3. Replace the `inFlightGeneration` drop-on-overlap pattern in
   `phoneFileSyncController.ts` with one explicit single-flight queue/mutex per controller.
   Both polling `check()` and realtime `syncPath()` must enter the same serialized path.
   Duplicate realtime events may coalesce, but no file may be downloaded or deleted twice.
4. Change controller teardown to an awaitable `stopAndDrain()` contract:
   - stop the timer;
   - detach the realtime subscription;
   - reject new work;
   - await the current queued operation;
   - return only when no download/delete operation remains.
5. Update `appLifecycleController.ts` to implement an idempotent asynchronous shutdown
   barrier. The first `before-quit` must prevent default completion, stop/drain phone and
   clipboard work, clean only the owned randomized download root, destroy controllers, and
   then perform the final quit. Repeated quit requests must reuse the same promise rather
   than starting a second teardown.
6. Delete the old `cleanupPhoneSyncDownloads()` directory traversal. Cleanup must operate
   only through the owned store's exact randomized root and remain idempotent.
7. Rewrite `phoneDownloadAsset.test.ts` to use real `fs.mkdtemp` directories rather than the
   nonexistent hard-coded `C:\\Users\\eren...` directory. Keep traversal, junction, exclusive
   create, and unrelated-sentinel tests.
8. Add deterministic concurrency tests using deferred promises, not timing sleeps:
   - poll and realtime event overlap;
   - stop requested during a download;
   - cleanup occurs after drain;
   - repeated shutdown returns the same completion;
   - a junction cannot redirect writes or cleanup.

Phase 1 index gate:

1. Finish all desktop tests and builds; close any process holding generated binaries.
2. Call Codebase Memory `index_repository` for the repository root and wait for its result.
3. Call `index_status`; require `status: "ready"`.
4. Trace `downloadFile`, `processFile`, controller teardown, and the owned store cleanup.
   Confirm there is one serialized download path and cleanup is reachable only after drain.
5. Do not begin Phase 2 until the index gate passes.

## Phase 2 — Complete Supabase clipboard contract

Files:

- `desktop/src/lib/supabaseSetup.ts`
- `desktop/test/supabaseSetup.test.ts`
- `desktop/src/main/clipboardSyncController.ts`
- `desktop/test/clipboardSyncController.test.ts`
- `mobile/lib/services/supabase_service.dart`
- `mobile/test/services/supabase_service_test.dart`
- `README.md`
- `docs/THREAT_MODEL.md`

Tasks:

1. Extend the idempotent setup SQL to create `public.clipboard_sync` with:
   - UUID primary key with a database-generated default;
   - non-null `content`, constrained to a documented maximum length;
   - non-null `source` constrained to `desktop` or `mobile`;
   - non-null `created_at` defaulting to `now()`;
   - an index supporting `source, created_at` polling order;
   - RLS enabled.
2. Add explicit `anon`/`authenticated` SELECT, INSERT, and DELETE policies required by the
   current dedicated-project model. Policies must be dropped/recreated idempotently and must
   validate `source` and content length on insert. Do not add UPDATE because the clients do
   not use it.
3. Add SQL tests asserting table creation, constraints, index, grants/policies, idempotent
   policy names, and safe quoting of the storage bucket identifier/literal.
4. Enforce the same content maximum in both clients before network I/O and produce a clear
   user-facing error instead of relying only on a database rejection.
5. Update the README setup flow and threat model to state that the anon key is a bearer
   capability for this dedicated Supabase project and that paired clients can read/delete
   clipboard rows and bucket objects allowed by the policies.

Phase 2 index gate:

1. Run targeted desktop SQL/clipboard tests and mobile service tests, then the full suites.
2. Reindex only after test processes exit.
3. Require `index_status: ready` and use `search_code` from the index to confirm every
   `clipboard_sync` access is covered by the generated setup SQL and documentation.
4. Do not begin Phase 3 until the index gate passes.

## Phase 3 — Mobile credentials, account identity, and signed-URL cache lifecycle

Files:

- `mobile/pubspec.yaml`
- `mobile/lib/main.dart`
- `mobile/lib/screens/settings_screen.dart`
- `mobile/lib/screens/home_screen.dart`
- `mobile/lib/providers/photos_provider.dart`
- `mobile/lib/services/gallery_cache.dart`
- `mobile/lib/services/photo_sync_state.dart`
- `mobile/lib/services/supabase_service.dart`
- Add `mobile/lib/services/connection_settings_store.dart`
- Add focused tests under `mobile/test/services/` and `mobile/test/providers/`.

Tasks:

1. Add `flutter_secure_storage` and introduce `ConnectionSettingsStore` as the sole owner of
   Supabase connection persistence. Store the anon key in secure storage; retain URL and
   bucket in ordinary preferences if desired.
2. Implement one-time migration: read an existing `supabase_anon_key` from
   `SharedPreferences`, write it to secure storage, verify the write, and only then remove
   the plaintext preference. Make migration idempotent and test success/failure behavior.
3. Define a non-secret account fingerprint from normalized Supabase URL plus bucket. Persist
   it beside gallery state. On settings save, initial setup, logout, or fingerprint mismatch:
   stop listeners, clear gallery cache and sync keys, switch the client, and then initialize
   the new gallery. Never mix records from two fingerprints.
4. Stop persisting signed URLs as if permanent. Persist stable photo metadata plus an
   explicit URL expiry timestamp, or omit the URL entirely. Before display/download, obtain
   a fresh signed URL when the cached URL is absent or near expiry.
5. Change gallery merge semantics: when a stable photo key already exists, replace its
   transient URL/expiry and updated metadata in place instead of skipping the incoming photo.
6. Remove the `getPublicUrl` fallback for a configured private bucket. A signing failure must
   remain a typed/recoverable error so the UI can show the configuration/RLS problem rather
   than caching a broken public URL.
7. Make channel teardown awaitable and ensure settings switch/logout waits for the previous
   realtime and polling listeners to stop before installing a new client.
8. Inject the service/settings/cache dependencies into `PhotosProvider` so expiry, merge,
   logout, and account-switch behavior can be tested without real network timing.
9. Add tests for expired URL refresh, near-expiry refresh, duplicate replacement, cold start,
   successful and failed key migration, account switch, logout, and no callback after dispose.

Phase 3 index gate:

1. Run Flutter formatting, analysis, and the complete Flutter test suite.
2. After all Flutter processes exit, reindex and require `index_status: ready`.
3. Trace settings save/logout to listener teardown and cache clearing. Search the index for
   `supabase_anon_key`; require no remaining plaintext write outside migration code/tests.
4. Search indexed production code for `getPublicUrl`; require no private-gallery fallback.
5. Do not begin Phase 4 until the index gate passes.

## Phase 4 — Complete storage pagination and resolve OCR contract

Files:

- `mobile/lib/services/supabase_service.dart`
- Add or extend pure pagination helpers under `mobile/lib/services/gallery_paging.dart`
- `mobile/test/services/gallery_paging_test.dart`
- `mobile/test/services/supabase_service_test.dart`
- `desktop/src/lib/ocr.ts`
- `desktop/src/ocr_helper.cs`
- `desktop/electron-builder.yml`
- `desktop/package.json`
- Add or extend desktop OCR tests under `desktop/test/`.

Tasks:

1. Implement offset-based loops for storage usage and purge in both bucket root and `to_pc`.
   Continue until a page is shorter than the page size; protect against a non-advancing
   offset or repeated page token.
2. Delete in bounded batches and count only confirmed deletions. Do not report success for
   files not returned by the API or for a failed removal batch.
3. Add tests covering 0, 1, 999, 1,000, 1,001, and multi-page mixed root/`to_pc` objects,
   including a deletion error in a later batch.
4. Make one decision for offline OCR and implement only that path:
   - Preferred: keep the packaged PowerShell implementation and remove the unused
     `ocr_helper.exe` discovery plus stale `ocr_helper.cs`; or
   - If the native helper is retained, update it to honor the output-file argument, add a
     reproducible build command with required WinRT references, package the executable, and
     capture/test its output contract.
   Do not leave both paths with different contracts. Prefer removal unless measurement shows
   a native helper is necessary.
5. Add a packaged-layout OCR test that verifies the exact resource path and a process test
   that verifies timeout/cleanup without depending on arbitrary sleeps.

Phase 4 index gate:

1. Run all mobile and desktop checks.
2. Reindex after all generated/build processes exit; require `ready`.
3. Search the graph for `limit: 1000`, `ocr_helper.exe`, and the removed/selected OCR path.
   Confirm no one-page usage/purge implementation and no split OCR contract remain.
4. Do not begin Phase 5 until the index gate passes.

## Phase 5 — Dependencies, CI, and signed release gates

Files:

- `desktop/package.json`
- `desktop/package-lock.json`
- `.github/workflows/desktop-ci.yml`
- `.github/workflows/mobile-ci.yml`
- `.github/workflows/release.yml`
- `desktop/electron-builder.yml`
- `mobile/android/app/build.gradle.kts`
- Add only the minimal Android signing-property loader files that do not contain secrets.
- `README.md`

Tasks:

1. Apply non-breaking dependency updates that remove the two production audit findings.
   Start with `npm audit fix` without `--force`, inspect the lockfile diff, and make explicit
   package upgrades only if required. Never use `npm audit fix --force` automatically.
2. Make desktop CI run the serial Jest suite only after typecheck/lint/format/audit pass.
3. Add `flutter test` to both Android and iOS mobile CI jobs before build steps.
4. Add the same release-blocking verification to release jobs, or factor reusable workflows
   so releases cannot package a commit that did not pass desktop tests/audit and mobile
   analyze/tests.
5. Remove Android's debug signing configuration from the release build. Load release signing
   values from CI/local properties and fail the release build clearly when they are absent.
6. Configure GitHub Actions to materialize the Android keystore only from repository secrets.
   Do not commit keystore bytes, aliases, or passwords.
7. Configure Electron signing through electron-builder's supported environment secrets and
   require signing in the GitHub release job. Preserve unsigned local development packaging
   only as an explicitly named development path.
8. Replace the unsigned iOS release artifact flow with a signing/provisioning-aware job.
   The job must fail with a clear missing-secret message rather than publishing an unsigned
   artifact as a release. Actual certificates/profiles remain a user-provided prerequisite.
9. Document required secret names and local release prerequisites without including secret
   values.

Phase 5 index gate:

1. Run full local verification possible without signing secrets. Validate workflow YAML and
   ensure missing signing material fails only release paths, not ordinary debug development.
2. Reindex and require `ready`.
3. Search the index for Android debug signing and `--no-codesign`; require no matches in
   release configuration.
4. Confirm production `npm audit --omit=dev --audit-level=high` exits zero.
5. Do not begin Phase 6 until the index gate passes. If signing secrets are unavailable,
   record external verification as pending but complete all configuration and local tests.

## Phase 6 — Behavior-preserving Electron composition refactor

Files:

- `desktop/src/main.ts`
- Add `desktop/src/main/electronPhoneSyncAdapter.ts`
- Add `desktop/src/main/electronClipboardSyncAdapter.ts`
- Add `desktop/src/main/electronLifecycleComposition.ts` only if it reduces dependencies
  without introducing a second lifecycle owner.
- Corresponding focused tests under `desktop/test/`.

Tasks:

1. Use the Phase 5 Codebase Memory graph to identify cohesive callback clusters currently
   embedded in `main.ts`. Extract the Supabase phone-file adapter and clipboard adapter into
   typed factories; keep controllers and business rules unchanged.
2. Keep exactly one composition root and one lifecycle owner. Do not introduce module-level
   mutable singletons beyond Electron's required app singleton.
3. Pass dependencies explicitly and keep each adapter independently testable. Avoid moving
   code merely to reduce line count; each extraction must lower `main.ts` outbound coupling.
4. Preserve IPC registration order, window startup order, serialized phone-sync barrier, and
   asynchronous shutdown barrier established in earlier phases.
5. Add contract tests for adapter wiring and repeat all existing main-source/preload/IPC tests.

Phase 6 final index gate:

1. Run every verification command in this plan.
2. Reindex after all commands exit and require `index_status: ready`.
3. Run `get_architecture(aspects=["all"])` and compare with the baseline. Require a material
   reduction in `desktop/src/main.ts` outbound coupling without new circular call clusters.
4. Trace phone download, shutdown, clipboard setup, settings switch, URL refresh, purge, and
   OCR paths one final time.
5. Only after this final gate may the executor mark the handoff plan `completed`.

# Verification

## Serialization protocol for every phase

Execute these steps strictly in order:

1. Stop application/build/watch processes that can mutate or lock repository files.
2. Make only the current phase's edits.
3. Run targeted tests.
4. Run the phase's full verification suite.
5. Wait for every test/build process to exit.
6. Invoke Codebase Memory `index_repository` with
   `repo_path = C:/Users/EREN/Desktop/CTRL2PHONE-main`.
7. Wait for the indexing response; do not edit files while indexing.
8. Invoke `index_status(project = C-Users-EREN-Desktop-CTRL2PHONE-main)` and require `ready`.
9. Run the phase-specific graph searches/traces.
10. Record the phase result, then start the next phase.

The preferred indexing surface is the Codebase Memory MCP tool, not a parallel shell job.
The portable binary currently exists at:

`C:\Users\EREN\Desktop\codebase-memory-mcp-main\pkg\npm\bin\codebase-memory-mcp.exe`

If the MCP connection is unavailable, start that binary over stdio and issue normal MCP
`initialize`, `notifications/initialized`, and `tools/call` requests. Do not rely on this
build's Windows CLI JSON argument parser, which failed during baseline setup.

## Desktop commands

From `C:\Users\EREN\Desktop\CTRL2PHONE-main\desktop` in PowerShell:

```powershell
$env:Path = "$([Environment]::GetEnvironmentVariable('Path','User'));$([Environment]::GetEnvironmentVariable('Path','Machine'))"
npm.cmd ci
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format:check
npm.cmd run build:native
npm.cmd test -- --runInBand
npm.cmd audit --omit=dev --audit-level=high
npm.cmd run build
npm.cmd run package
```

Use focused Jest commands during phases, for example:

```powershell
npm.cmd test -- --runInBand test/phoneDownloadAsset.test.ts test/phoneFileSyncController.test.ts test/appLifecycleController.test.ts
npm.cmd test -- --runInBand test/supabaseSetup.test.ts test/clipboardSyncController.test.ts
```

## Mobile commands

From `C:\Users\EREN\Desktop\CTRL2PHONE-main\mobile`:

```powershell
flutter pub get
dart format --output=none --set-exit-if-changed lib test
flutter analyze
flutter test
flutter build apk --debug
```

Release builds are verified only after the required signing material is supplied:

```powershell
flutter build apk --release
flutter build ipa --release
```

## Structural checks after reindex

- `search_code` for each changed security/storage identifier.
- `trace_path` for lifecycle and sync functions changed by the phase.
- `get_code_snippet` for graph hits before drawing conclusions.
- `get_architecture(aspects=["all"])` at the final phase.
- Never treat a missing graph edge as proof until the relevant source file is confirmed in the
  current index and the snippet is read.

# Acceptance Criteria

1. A clean desktop start receives a phone image without pre-existing temp directories.
2. Polling, realtime delivery, shutdown, and cleanup cannot overlap destructively; teardown
   is awaitable and idempotent.
3. No predictable junction can redirect phone download writes or cleanup.
4. The generated Supabase SQL fully and idempotently provisions storage plus clipboard
   requirements documented by the clients.
5. Clipboard payload size is validated consistently on desktop, mobile, and database layers.
6. Mobile Supabase key migration removes plaintext storage after a verified secure write.
7. Switching project/bucket or logging out cannot retain or display the previous gallery.
8. Expired signed URLs are refreshed and duplicate photo records receive updated transient
   URLs instead of being skipped.
9. Private-bucket signing errors are visible and are not replaced with broken public URLs.
10. Usage and purge handle more than 1,000 objects and report partial failures accurately.
11. Exactly one tested offline OCR contract remains.
12. Desktop typecheck, lint, formatting, native build, all Jest tests, production audit, build,
    and package succeed.
13. Mobile formatting, analysis, all Flutter tests, and debug build succeed.
14. Release workflows refuse unsigned/debug-signed production artifacts and document all
    required external signing inputs.
15. Every phase ends with a fresh Codebase Memory index in `ready` state and phase-specific
    graph verification.
16. Final architecture retains one composition root and reduces `main.ts` coupling without
    introducing lifecycle or call-graph cycles.

# Constraints/Risks

- This repository copy currently has no `.git` metadata visible to Codebase Memory, so
  git-diff-based `detect_changes` may be unavailable. Use the explicit phase file list,
  source reads, tests, and fresh full indexing instead.
- Signing configuration can be implemented, but successful production signing is blocked
  until the user supplies valid Windows, Android, and Apple credentials/secrets.
- Supabase SQL must remain idempotent because users may rerun “Secure Setup.” Existing user
  data must not be dropped or truncated.
- Secure-storage migration must fail safe: never delete the plaintext key until the secure
  copy has been written and read back successfully.
- Asynchronous shutdown changes are high risk. Use deterministic deferred-promise tests and
  avoid timing-based sleeps.
- Do not combine Phases 1–6 into one patch. A failed phase must be repaired and reindexed
  before any later phase starts.
- Do not run Codebase Memory indexing concurrently with edits, npm/Flutter formatting,
  native compilation, packaging, or another index request.
- Do not mark this plan `completed` merely because configuration is written; all locally
  verifiable gates and the final reindex must pass.
