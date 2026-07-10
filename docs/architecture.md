# Architecture

Penny keeps model assistance separate from the writer's draft. The app can
check a draft locally, ask a loopback model for a suggestion, and show the
result for review. Only an explicit writer action changes the document.

The [Gemma 4 and MLX reference setup](gemma-mlx-reference.md) describes the
tested two-model local deployment. Penny itself remains compatible with another
approved OpenAI-compatible loopback endpoint.

## Components

- `app/src/`: React workspace UI and explicit apply controls.
- `server/server.mjs`: loopback HTTP server, API boundary, and static files.
- `server/domain.mjs`: modes, profiles, workspace schema, and normalization.
- `server/style_rules.mjs`: generic deterministic style findings.
- `server/voice_rules.mjs`: profile-driven heuristic analysis and rewrite brief.
- `server/penny_agent.mjs`: loopback model request and response contract.
- `server/storage.mjs`: private local workspace persistence.
- `server/voice_pack_*.mjs`: pack validation, loading, and registry creation.

## What Penny Protects

The server accepts approved loopback hosts by default and checks the API token,
origin, referer, content type, and request size. An optional tailnet host must
be allowlisted. Remote runtime actions stay disabled by default.

Model responses do not mutate documents. Penny stores a candidate with source
context, checks freshness before apply, and requires an explicit writer action.
Workspace data is written to a private directory with mode `0700` and a file
with mode `0600`.

Voice packs are untrusted local configuration. They are JSON, schema-validated,
and cannot supply regular expressions, JavaScript, commands, or remote URLs.

## Model connection modes

Local mode uses the loopback MLX-compatible endpoint and may consult the
allowlisted local runtime adapter. Shared mode is a separate, explicit posture:

- the configured URL must still be plain HTTP on loopback;
- an external tunnel provides transport to the remote host;
- Penny reads a bearer token from an absolute local file path;
- requests use the stable `penny-writing` alias;
- local runtime status and actions are not consulted; and
- responses report both the requested alias and the model identifier returned
  by the service.

The shared queue remains responsible for admission, serialization, and model
selection. Penny treats `429` as queue pressure, `503` as service unavailability,
an abort as a wait timeout, other non-success responses as generation failures,
and failed fetches as connection failures. It never retries a generation
automatically because an ambiguous retry could produce duplicate work.
