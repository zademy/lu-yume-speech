# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| develop | :white_check_mark: |

Only the latest commit on `develop` / `main` receives security updates.

## Reporting a Vulnerability

**Do not file a public issue for security vulnerabilities.**

Use [GitHub's private vulnerability reporting][gh-advisory] for this repository
(**Security** tab → **Report a vulnerability**).

Please include:

- A clear description of the vulnerability.
- Steps to reproduce or a proof of concept.
- The affected version or commit hash.
- Any potential impact you have identified.

We aim to acknowledge reports within **48 hours** and provide an initial
assessment within **5 business days**.

## Known Security Considerations

LU YUME is a desktop application built with Tauri 2 (Rust + native WebView).

| Area                  | Detail                                                                                                                                                                                                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API key storage**   | The Groq API key is stored in the OS-native credential store (macOS Keychain / Windows Credential Manager / Linux Secret Service) via Tauri's `keyring` backend. It is **never** written to `localStorage`, `sessionStorage`, the JS bundle, or disk. See `src-tauri/src/commands/api_key.rs`.                                              |
| **Web / dev fallback** | When running outside Tauri (pure browser dev mode via `pnpm dev`), a `WebBridge` stores the key in `localStorage` under the `stt_groq_api_key` key. This is a **development convenience only** and is not a supported product path. Do not deploy the web build with a key loaded.                                                          |
| **No backend**        | There is no backend server. All data processing happens client-side. The only network egress is `https://api.groq.com` (allowlisted in the Content Security Policy).                                                                                                                                                                         |
| **Content Security Policy** | Enforced by Tauri: `default-src 'self'; connect-src 'self' https://api.groq.com ipc: http://ipc.localhost`. No inline scripts, no eval, no third-party origins. Defined in `src-tauri/tauri.conf.json`.                                                                                                                                |
| **Microphone access** | The OS prompts the user for microphone permission before any audio is captured. No audio is recorded without explicit user consent.                                                                                                                                                                                                         |
| **Transcription history** | Stored locally via the platform bridge (settings file on desktop, `localStorage` on web). Never transmitted anywhere except the audio sent to Groq for transcription.                                                                                                                                                                   |
| **Bundle integrity**  | The previous architecture (`VITE_GROQ_API_KEY` prefix) inlined the key into the JS bundle. This has been removed. The key is now injected at runtime from the keychain — `grep -rn 'gsk_' dist/` returns no real keys.                                                                                                                         |

### Key rotation history

> The key `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`
> was previously present in a local `.env` file (never committed to git).
> It has been **revoked** at https://console.groq.com/keys as part of
> the Tauri migration. If you find this key in any artifact, treat it
> as compromised and report it immediately.

## Scope

**In scope:**

- Cross-site scripting (XSS) in the rendered UI.
- Unauthorized access to the Groq API key from a third-party context.
- CSP bypass or WebView escape.
- Manipulation of transcription history or settings via DOM injection.
- Any vulnerability in the Tauri command interface (`src-tauri/src/commands/`).
- Any vulnerability in the build output that could be exploited in a distributed installer.

**Out of scope:**

- Groq API service outages or vulnerabilities on Groq's side.
- Browser / WebView-level exploits (e.g., compromised browser extensions).
- Denial-of-service attacks against the Groq API triggered from the client.
- Social engineering attacks.

## Disclosure Policy

- We follow a **responsible disclosure** process.
- Once a fix is merged, we will credit the reporter in the commit message
  (unless they prefer to remain anonymous).
- We request a **90-day window** to address the vulnerability before public
  disclosure.

[gh-advisory]: https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability
