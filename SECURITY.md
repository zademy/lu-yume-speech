# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |

This project is in early development. Only the latest commit on `main` receives security updates.

## Reporting a Vulnerability

**Do not file a public issue for security vulnerabilities.**

Instead, use [GitHub's private vulnerability reporting][gh-advisory] for this
repository. You can find it under the **Security** tab → **Report a
vulnerability**.

Please include:

- A clear description of the vulnerability.
- Steps to reproduce or a proof of concept.
- The affected version or commit hash.
- Any potential impact you have identified.

We aim to acknowledge reports within **48 hours** and provide an initial
assessment within **5 business days**.

## Known Security Considerations

This application runs entirely in the browser. Be aware of the following:

| Area                  | Detail                                                                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API key**           | The Groq API key is stored in the browser's `localStorage` and sent directly from the client to the Groq API. This key is visible in browser DevTools. Do not expose this project on a shared or public machine with a key loaded. |
| **No server**         | There is no backend. All data processing happens client-side. No user data is transmitted anywhere except the audio sent to Groq for transcription.                                                                                |
| **Microphone access** | The browser prompts the user for microphone permission before any audio is captured. No audio is recorded without explicit user consent.                                                                                           |
| **localStorage**      | Transcription history and user preferences are stored in `localStorage`. This data persists across sessions but never leaves the browser. Clearing browser data removes it entirely.                                               |

## Scope

The following are **in scope** for security reports:

- Cross-site scripting (XSS) in the rendered UI.
- Unauthorized access to the Groq API key from a third-party context.
- Manipulation of transcription history or settings via DOM injection.
- Any vulnerability in the build output that could be exploited in a hosted deployment.

The following are **out of scope**:

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
