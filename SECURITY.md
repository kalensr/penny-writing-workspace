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

## Shared model mode

Shared model mode does not weaken Penny's loopback boundary. Use an authenticated
loopback tunnel; do not bind either Penny's model port or the upstream model to
LAN, tailnet, or public interfaces. Penny accepts the queue credential only as a
file path. Keep that file outside Git and restrict it to its owner. The service
manager persists the path, not the token, and redacts the path from status
output.

Shared mode disables Penny's local runtime-control routes. This prevents an
automation, browser request, or stale configuration from turning on a local
model as an implicit fallback while Penny is meant to use the shared service.
The shared service should return an actual model identifier for auditability;
Penny exposes it as response metadata without treating it as an instruction.
