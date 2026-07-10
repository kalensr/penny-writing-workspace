# Security Policy

## Supported Version

Security fixes target the current default branch and latest tagged release.

## Reporting A Vulnerability

Use GitHub's private vulnerability reporting for this repository. Do not open a
public issue with credentials, private workspace data, host details, or an
exploit that has not been coordinated.

## Security Model

Penny is a single-user local application. It binds to loopback by default,
requires an API token, checks browser request headers, rejects non-loopback
model endpoints, limits request bodies, and keeps remote runtime control off by
default. Voice packs are local data, not executable plugins.

Penny does not claim to sandbox a local model, protect a compromised host, or
provide multi-user authorization. Review optional network exposure and runtime
adapters for your environment.

