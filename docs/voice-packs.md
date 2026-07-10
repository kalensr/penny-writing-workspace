# Voice Packs

Voice packs add local writing profiles without changing Penny's code. The
public default pack is `voice-packs/default/voice-pack.json`.

## Contract

A version 1 pack defines metadata, one or more profiles, literal marker lists,
rhetorical slots, required slots by mode, and numeric thresholds. A profile
defines its ID, label, description, voice mode, output policy, capabilities,
and locked writing guidance.

Supported output policies are `plain_text` and `journal_markdown`. The only
current optional capability is `positioning_context`.

Packs cannot contain executable code, regular expressions, shell hooks, remote
installation instructions, or absolute paths. Duplicate IDs and unknown fields
fail startup before the server accepts requests.

## Loading A Pack

Place one or more `.json` files in a private directory and set:

```sh
PENNY_VOICE_PACK_DIR=/opt/penny/voice-packs npm run server
```

The last pack in sorted load order supplies the default profile. Profile IDs
must be unique across all loaded packs.

If an optional directory is missing, Penny starts with built-in profiles and
reports a warning through the config API. A saved profile ID that is not loaded
remains in the workspace and appears as unavailable until the writer chooses a
replacement.

