# Architecture

Penny keeps the application small and separates deterministic review from model
collaboration.

## Components

- `app/src/`: React workspace UI and explicit apply controls.
- `server/server.mjs`: loopback HTTP server, API boundary, and static files.
- `server/domain.mjs`: modes, profiles, workspace schema, and normalization.
- `server/style_rules.mjs`: generic deterministic style findings.
- `server/voice_rules.mjs`: profile-driven heuristic analysis and rewrite brief.
- `server/penny_agent.mjs`: loopback model request and response contract.
- `server/storage.mjs`: private local workspace persistence.
- `server/voice_pack_*.mjs`: pack validation, loading, and registry creation.

## Trust Boundaries

The server accepts approved loopback hosts by default and checks the API token,
origin, referer, content type, and request size. An optional tailnet host must be
allowlisted. Remote runtime actions stay disabled by default.

Model responses do not mutate documents. Penny stores a candidate with source
context, checks freshness before apply, and requires an explicit writer action.
Workspace data is written to a private directory with mode `0700` and a file
with mode `0600`.

Voice packs are untrusted local configuration. They are JSON, schema-validated,
and cannot supply regular expressions, JavaScript, commands, or remote URLs.

