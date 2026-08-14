# Security Policy

## Reporting a vulnerability

Please report security issues privately via GitHub's **"Report a vulnerability"**
button (Security → Advisories) rather than opening a public issue. We aim to
acknowledge within a few days.

## Scope notes

- The SQL provider **never string-interpolates values** — every `Constant`
  becomes a bound `$n` parameter, and `LIKE` patterns escape `%`, `_`, and `\`.
  Reports of interpolation or injection paths are high priority.
- Runtime packages carry **zero third-party dependencies**, minimizing supply-chain
  surface; the build-time parser (`oxc-parser`) and sourcemap tool (`magic-string`)
  are dev-time only.
- Published packages use **npm provenance** via GitHub OIDC.
