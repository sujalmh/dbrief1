# Security Policy

## Supported Versions

Only the latest `main` is supported with security updates.

## Reporting a Vulnerability

Please **do not** open a public issue for security problems.

- Preferred: use **Report a vulnerability** on the
  [Security tab](https://github.com/sujalmh/dbrief1/security)
  (private vulnerability reporting).
- Alternative: contact the maintainer directly.

We aim to acknowledge reports within 72 hours. Please include:
1. A description of the issue and its potential impact.
2. Steps to reproduce (or proof of concept).
3. The commit or release you tested against.

## Scope Notes

- API keys, OAuth secrets, and Cloudflare tokens live in environment
  variables (`.env.local`, never committed). If you spot a leaked
  credential in the history, report it immediately so it can be
  rotated and purged.
- The app validates all tool output as untrusted data; prompt-injection
  reports against the data plane are in scope.
