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

LU YUME is a browser SPA (TypeScript + Vite) with no backend.

| Area                      | Detail                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API key storage**       | The Groq API key is stored in the browser's `localStorage` under the `stt_groq_api_key` key via the `WebBridge` platform implementation. It is **never** written to `sessionStorage` or the JS bundle. Be aware that browser-side storage is only as secure as the origin serving the app.                                                                                                                             |
| **No backend**            | There is no backend server. All data processing happens client-side. The only network egress is `https://api.groq.com`.                                                                                                                                                                                                                                                                                                |
| **Network egress**        | When deploying, set a `Content-Security-Policy` such as `default-src 'self'; connect-src 'self' https://api.groq.com`. No inline scripts, no eval, no third-party origins.                                                                                                                                                                                                                                             |
| **Microphone access**     | The browser prompts the user for microphone permission before any audio is captured. No audio is recorded without explicit user consent.                                                                                                                                                                                                                                                                               |
| **Transcription history** | Stored locally in browser storage (`localStorage` / IndexedDB). Never transmitted anywhere except the audio sent to Groq for transcription.                                                                                                                                                                                                                                                                            |
| **LLM post-processing**   | The optional "Refinado con LLM" feature sends the transcribed **text** (not audio) to the Groq chat completions endpoint at the same `https://api.groq.com` origin, reusing the stored API key. It is **off by default**. When disabled, no transcription text leaves the client beyond the original Whisper request. Output is constrained by a strict JSON schema; the call fails open to the raw text on any error. |
| **Transcript summaries**  | The manual "Generar resumen" action sends an exact snapshot of the current visible **text** (never audio) to Groq chat completions using `openai/gpt-oss-20b` and the stored API key. The source is treated as untrusted content, and output is constrained by a strict JSON schema. Summaries and source snapshots remain in local browser storage. |
| **Bundle integrity**      | The previous architecture (`VITE_GROQ_API_KEY` prefix) inlined the key into the JS bundle. This has been removed. The key is now read at runtime from browser storage — `grep -rn 'gsk_' dist/` returns no real keys.                                                                                                                                                                                                  |

### Key rotation history

> The key `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`
> was previously present in a local `.env` file (never committed to git).
> It has been **revoked** at https://console.groq.com/keys. If you find
> this key in any artifact, treat it as compromised and report it
> immediately.

## Scope

**In scope:**

- Cross-site scripting (XSS) in the rendered UI.
- Unauthorized access to the Groq API key from a third-party context.
- Manipulation of transcription history or settings via DOM injection.
- Any vulnerability in the platform bridge (`src/platform/`).
- Any vulnerability in the build output served to users.

**Out of scope:**

- Groq API service outages or vulnerabilities on Groq's side.
- Browser-level exploits (e.g., compromised browser extensions).
- Denial-of-service attacks against the Groq API triggered from the client.
- Social engineering attacks.

## Disclosure Policy

- We follow a **responsible disclosure** process.
- Once a fix is merged, we will credit the reporter in the commit message
  (unless they prefer to remain anonymous).
- We request a **90-day window** to address the vulnerability before public
  disclosure.

[gh-advisory]: https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability
