# Ctrl2Phone — Threat Model

> Scope: the open-source desktop (Electron) + mobile (Flutter) apps and the Supabase
> Storage bucket they share. Ctrl2Phone is a **single-user, bring-your-own-backend**
> tool — there is no Ctrl2Phone server and no multi-tenant isolation. This document
> states what is protected, what is not, and the residual risks you accept by using it.

## 1. Assets

| # | Asset | Where it lives |
|---|---|---|
| A1 | **Screenshots / cropped regions** (may contain anything on your screen) | RAM during capture; the clipboard; the Supabase bucket (transiently); the AI provider you choose |
| A2 | **Supabase anon key** | Desktop `settings.json` (encrypted); the pairing **QR code**; the mobile app's storage |
| A3 | **AI provider API key** (Gemini / Claude / OpenAI / custom) | Desktop `settings.json` (encrypted); sent to the chosen provider over TLS |
| A4 | **Supabase project** (storage contents + quota) | Your Supabase account |

## 2. Trust boundaries

```
[ Your screen ] → Desktop main process → ┬→ AI provider (Gemini/Claude/OpenAI/local)   (TLS, API key)
                                         ├→ Gemini Web window                           (Google session)
                                         └→ Supabase Storage bucket ←→ Mobile app       (TLS, anon key + RLS)
                                                      ↑
                              Pairing QR code carries the anon key (desktop → phone camera)
```

- **main ↔ renderer** — Electron `contextIsolation: true`, `nodeIntegration: false`, a
  minimal `contextBridge` preload, and a restrictive CSP on the renderer. The renderer
  cannot reach Node or the filesystem directly.
- **Desktop ↔ Supabase** — authenticated only by the **anon key**; access is constrained
  by **Row Level Security** once the in-app *Secure Setup (RLS)* SQL has been run.
- **Desktop ↔ AI provider** — the cropped PNG + your prompt leave your machine for the
  provider you selected. The network request runs in the **main** process (no CORS/CSP).
- **The bucket is the phone↔PC transport** — both devices authenticate with the *same*
  anon key. Anyone holding that key has full access to the bucket.

## 3. Actors

- **Legitimate user** (you).
- **Network attacker** — passive eavesdropper or active MITM on the path to Supabase /
  the AI provider.
- **Anon-key holder** — anyone who obtains the key (shoulder-surfs the QR, reads it off a
  rooted/lost phone, finds it committed somewhere).
- **Opportunistic reader** — someone who learns your *project URL + bucket name*.
- **Local attacker** — code running on your machine as your OS user.
- **The provider itself** — Supabase, Google, Anthropic, OpenAI, or your custom endpoint.

## 4. Threats & mitigations (STRIDE)

| Threat | Vector | Mitigation in Ctrl2Phone |
|---|---|---|
| **Information disclosure** | Bucket is **Public** by default → screenshots world-readable to anyone who guesses URL + filename | Run **Secure Setup (RLS)**: bucket becomes **private**, reads go through short-lived **signed URLs**, and filenames are **random UUIDs** (not enumerable). |
| **Information disclosure** | Secrets at rest in `settings.json` | `supabaseKey` and `aiApiKey` are encrypted with Electron **`safeStorage`** (OS keychain / DPAPI). Never logged in plaintext. |
| **Information disclosure** | Screenshot + prompt sent to a cloud model | Inherent to using a hosted model — **you choose the provider**. Use the **custom/local** provider (Ollama, LM Studio) to keep everything on-device, or *Web* mode to keep it within your own Google session. |
| **Spoofing / Tampering** | Forged reads/writes to the bucket | RLS policies scope `select/insert/update/delete` to your one bucket for `anon`; all transport is TLS. |
| **Tampering** | Malicious payload posing as an incoming image | Phone→PC files are validated as real images before use; a download that isn't a valid image is **kept (not deleted)** for retry, never executed. |
| **Denial of service** | Filling the free-tier storage quota | **Purge Cloud** button; phone→PC items are deleted only **after** a successful local copy (ack-after-success). |
| **Elevation of privilege** | Renderer → Node / RCE | `contextIsolation` + no `nodeIntegration` + CSP; the renderer talks to main only through the typed preload bridge. |
| **Elevation / abuse** | Global keyboard hook capturing keystrokes | The C# `WH_KEYBOARD_LL` hook only **swallows** keys while the selection overlay is active (smart key-blocking); it runs at your own user privilege and ships as source you compile. |

## 5. Residual risks (accepted / out of scope)

1. **The anon key is a shared bucket credential, by design.** Whoever has it can read and
   write the whole bucket. This is not multi-tenant — rotate the key in Supabase if it
   leaks, and re-pair the phone.
2. **Mobile stores Supabase credentials in plaintext** (`SharedPreferences`) today. A
   rooted device or a backup extraction can read them. Migrating to
   `flutter_secure_storage` is planned (tracked separately).
3. **The AI provider sees your screenshot and prompt.** Web mode pastes into Google;
   API mode posts to the provider you picked. Choose the local/custom provider for
   sensitive content.
4. **`safeStorage` protects against other users / off-device theft, not against code
   running as you.** On Windows it uses DPAPI bound to your OS account, so a process
   running as the same user can decrypt `settings.json`.
5. **The clipboard is a shared surface.** Captures and OCR text are placed on the system
   clipboard; any app you run can read it.
6. **Installers are not code-signed yet.** Expect SmartScreen/Gatekeeper warnings and
   verify your download source. Building from source avoids the supply-chain question
   entirely. (Code signing is tracked separately.)

## 6. Hardening checklist for users

- [ ] Run **Secure Setup (RLS)** immediately after entering your Supabase details.
- [ ] Use the **Anon** key — never the Service key — in the app or QR code.
- [ ] Treat the **pairing QR code** like a password; don't share screenshots of it.
- [ ] Prefer the **local/custom AI provider** for confidential screens.
- [ ] **Purge Cloud** periodically; the bucket is a transport, not an archive.
- [ ] Rotate the anon key and re-pair if a device is lost.
