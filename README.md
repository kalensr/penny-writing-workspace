# Penny Writing Workspace

Penny is a local writing workspace for writers who want model help without
sending a draft to a hosted service. Select a passage or use the full draft,
ask for a revision or critique, compare the suggestion, and decide what enters
the document.

Penny keeps the writer in control. Model suggestions stay separate from the
draft until the writer reviews and applies them. Its deterministic checks are
editing signals, not a verdict on authorship or quality.

![Penny desktop workspace](docs/assets/penny-desktop.png)

## A Tested Local Reference

Penny works with an OpenAI-compatible model endpoint on loopback. Its tested
reference setup runs two Gemma 4 models through MLX on Apple silicon:

- **Daily:** Gemma 4 26B-A4B for drafting and routine revision.
- **Quality:** Gemma 4 31B for a slower, more deliberate second pass.

See [the Gemma 4 and MLX reference setup](docs/gemma-mlx-reference.md) for the
Mac Studio configuration, model settings, proven installation path, and limits.

## What Penny Includes

- Three-pane writing workspace with projects and documents.
- Selected-text and full-draft collaboration modes.
- Response candidates, inline notes, previews, discard, apply, and session undo.
- Generic reflective, executive, and raw-journal profiles.
- Schema-validated, data-only local voice packs.
- Deterministic House Style, AI-voice, center-of-gravity, and punctuation checks.
- Optional OpenAI-compatible loopback model and runtime-control adapters.
- Optional Tailscale Serve path mode with host and identity allowlists.

## Requirements

- Node.js 22 or newer.
- npm.
- A Chromium browser for browser smoke tests.
- Optional: an OpenAI-compatible model endpoint on loopback.

## Quickstart

```sh
npm install
npm run build
npm run server
```

Open `http://127.0.0.1:4177`. The editor and deterministic checks work without
a model. Model-backed actions use `http://127.0.0.1:8091/v1` by default. Start
with the [reference setup](docs/gemma-mlx-reference.md) if you want the tested
Gemma 4 configuration.

To use another loopback endpoint:

```sh
PENNY_MODEL_BASE_URL=http://127.0.0.1:9000/v1 npm run server
```

Penny rejects non-loopback model URLs.

### Optional shared model

Penny can use a shared OpenAI-compatible service through a loopback tunnel.
Shared mode always requests the stable `penny-writing` model alias, never starts
or inspects a local model runtime, and reads its bearer token from a file. It
does not accept an inline credential.

```sh
PENNY_MODEL_MODE=shared \
PENNY_MODEL_BASE_URL=http://127.0.0.1:8092/v1 \
PENNY_MODEL_CREDENTIAL_FILE=/private/path/penny-queue-token \
PENNY_MODEL_TIMEOUT_MS=420000 \
npm run server
```

Keep the credential file outside the repository with owner-only permissions.
The 420-second timeout accommodates a bounded, serialized generation queue; it
does not make Penny retry failed generations automatically. Penny distinguishes
queue-full, service-unavailable, wait-timeout, generation, configuration, and
connection failures so the writer can choose a safe next action.

`scripts/penny-server.sh on`, `restart`, and `plist` preserve settings that are
not named in the current command, using the loaded launchd environment first
and the existing plist second. Set a supported variable to an empty string to
clear it explicitly. Tailscale maintenance changes only its host, user, and
path settings; it does not clear shared-model credentials, runtime ownership,
workspace state, or private voice-pack configuration.

## Voice Packs

The built-in pack is in `voice-packs/default/voice-pack.json`. Load additional
local JSON packs from a directory:

```sh
PENNY_VOICE_PACK_DIR=/opt/penny/voice-packs npm run server
```

Packs contain data only. Penny rejects unknown fields, unsupported versions,
duplicate profile IDs, absolute paths in pack text, and unsupported policies.
See [Voice packs](docs/voice-packs.md).

## Optional Runtime Adapter

Set `PENNY_RUNTIME_SCRIPT` to an executable that accepts Penny's allowlisted
runtime actions. Runtime controls remain unavailable when no adapter is set.
They are disabled whenever `PENNY_MODEL_MODE=shared` so shared Penny cannot
silently fall back to or manipulate a host-local writing model.

```sh
PENNY_RUNTIME_SCRIPT=/opt/penny-runtime/writing-runtime.sh npm run server
```

## Optional Tailscale Access

Penny can run behind Tailscale Serve while the application still listens only
on loopback. Use a host allowlist and, where applicable, a Tailscale user
allowlist. Remote runtime actions remain disabled unless explicitly enabled.

```sh
PENNY_TAILSCALE_HOST=writer-server.example-tailnet.ts.net \
PENNY_TAILSCALE_USERS=writer@example.com \
PENNY_TAILSCALE_PATH=/penny \
scripts/penny-tailscale.sh on
```

Review the script output before using it on a host that already has Tailscale
Serve routes.

## Validation

```sh
npm run validate
npm audit --audit-level=high
scripts/check-public-tree.sh
```

`npm run validate` runs Node tests, Python script tests, the production build,
browser smoke, and the runtime parity dry run. The browser smoke may target an
already running server through `PENNY_BASE_URL`.

## Architecture And Security

- [Architecture](docs/architecture.md)
- [Gemma 4 and MLX reference setup](docs/gemma-mlx-reference.md)
- [Voice packs](docs/voice-packs.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

Workspace files, model weights, logs, drafts, environment files, and local
voice packs are ignored. Do not publish a working-directory copy; publish from
reviewed Git history or a Git archive.

## License

MIT. See [LICENSE](LICENSE).
