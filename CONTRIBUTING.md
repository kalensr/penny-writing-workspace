# Contributing

Open an issue before a large behavior or architecture change. Keep pull
requests focused and use synthetic examples only.

## Development

```sh
npm install
npm test
npm run build
npm run browser-smoke
```

Before submitting, run `npm run validate`, `npm audit --audit-level=high`,
`scripts/check-public-tree.sh`, and `git diff --check`.

Do not include private drafts, real hostnames, local account names, credentials,
personal voice calibration, model weights, or generated workspace state.

