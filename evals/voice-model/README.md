# Penny Voice Model Evaluation

This evaluation set tests whether a local model improves Kalen's writing without replacing his voice. Penny owns the reusable prompts, runner, and scoring contract because this is a Penny product-quality check.

Private writing does not belong in this public repository. Supply an absolute path to an approved local-only input directory when running the evaluation. The runner writes raw responses under the ignored `runtime/` directory with owner-only permissions.

## Required Private Inputs

The input directory must contain:

- `journal-voice-preservation-excerpt.md`
- `journal-rough-to-polished-excerpt.md`
- `polished-reference-style-packet.md`

These names describe the evaluation roles, not permission to track the files. Do not copy raw journals, authored reference packets, model outputs, or scored private metrics into Git.

## Run

Use a loopback-only OpenAI-compatible endpoint. Confirm the shared Penny queue is idle before using the direct MLX endpoint.

```bash
npm run eval:voice-model -- \
  --base-url http://127.0.0.1:8091/v1 \
  --model default_model \
  --input-dir /absolute/path/to/approved/private-inputs
```

The runner uses the established comparison settings:

- temperature `0.4`;
- top-p `0.9`;
- output caps of 850, 1,300, and 850 tokens;
- sequential execution;
- no output text printed to the terminal.

## Review

Use [scoring-rubric.md](scoring-rubric.md) with the private Kalen voice rubric and the House Style System. Score comparable outputs only after every model has completed the same cases. Keep automated style checks separate from human judgment.

The June 2026 baseline for the previous Gemma 4 26B daily model was:

| Case | Quality | Time | Throughput |
| --- | ---: | ---: | ---: |
| Voice preservation | 4.1 | 46.290s | 10.74 tok/s |
| Rough to polished | 3.8 | 54.564s | 16.99 tok/s |
| Style analysis | 3.9 | 54.721s | 15.53 tok/s |

Those numbers are safe summary evidence. The underlying source packets and outputs remain private local-only artifacts.
