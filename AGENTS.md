# Repository Instructions

## Scope

This repository owns the public Penny application, generic deterministic
writing checks, and the data-only voice-pack contract.

## Safety

- Keep the application and model endpoint loopback-bound by default.
- Do not commit workspaces, drafts, logs, model files, credentials, hostnames,
  account identifiers, or private voice packs.
- Keep optional runtime and Tailscale adapters generic and disabled safely when
  they are not configured.
- Preserve unknown saved profile IDs. Never silently remap persisted profiles.
- Model output must remain reviewable until the writer explicitly applies it.

## Validation

Run `npm run validate`, `npm audit --audit-level=high`,
`scripts/check-public-tree.sh`, and `git diff --check` before handoff.

Use `scripts/check-public-history.sh` on a release candidate with reviewed
history. Run browser smoke on a free port if `4177` already has a server.
