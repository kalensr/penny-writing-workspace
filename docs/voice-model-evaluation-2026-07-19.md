# Penny Voice Model Evaluation, July 2026

## Decision

Keep the corrected Gemma 4 26B model as Penny's daily model. On the recovered Kalen-voice evaluation set, it is effectively even with the previous model overall, better on the harder rough-to-polished task, and substantially faster in the observed Studio run.

The quality comparison is useful because both models received the same prompts and private input packets. The speed comparison is directional rather than controlled: the previous run occurred on the 64 GB MacBook Pro, while the corrected model ran on the 36 GB Mac Studio with a newer runtime environment.

## Evidence Location and Ownership

The original evaluation was created and executed on the MacBook Pro on June 27, 2026. The tracked prompt definitions and rubric had also been copied into `llm-local-delegation`, but its private ignored inputs, raw outputs, scored metrics, and report existed only in the MacBook checkout.

On July 19, the private evidence was copied to the Mac Studio with source and destination SHA-256 parity. It remains ignored and owner-only. No private journal text, authored reference packet, model response, hostname, or account identifier was added to this repository.

Penny now owns the reusable public-safe evaluation contract under `evals/voice-model/`. Private input packets remain an explicit local overlay supplied by absolute path. Raw outputs and receipts are written only under ignored `runtime/` storage.

## Models

| Role | Model | Revision |
| --- | --- | --- |
| Previous daily baseline | `mlx-community/gemma-4-26B-A4B-it-qat-OptiQ-4bit` | `76126a01b31925ddca7705b388116dcdc58256fd` |
| Corrected daily model | `unsloth/gemma-4-26b-a4b-it-UD-MLX-4bit` | `ea6005b2a9b3dda91bcb26cb94a6ddf3a2eea4df` |

Both evaluations used temperature `0.4`, top-p `0.9`, disabled thinking, the same three prompt files, and the same private source packets. Prompt SHA-256 values are pinned in the Penny test suite.

## Results

| Case | Previous quality | Corrected quality | Previous time | Corrected time | Judgment |
| --- | ---: | ---: | ---: | ---: | --- |
| Voice preservation | 4.1 | 4.0 | 46.290s | 13.841s | Comparable. The corrected output preserved discernment and action but ended with a slightly choppier reflective cadence. |
| Rough to polished | 3.8 | 4.1 | 54.564s | 21.471s | Corrected model preferred. It retained more concrete source detail and emotional tension with fewer deterministic style findings. |
| Style analysis | 3.9 | 3.8 | 54.721s | 23.144s | Previous output slightly preferred. The corrected brief was specific but used some AI-like labels, contained one typo, and reached the same 850-token cap. |

Weighted results from the established rubric:

| Model | Overall | Writing | Synthesis |
| --- | ---: | ---: | ---: |
| Previous daily model | 3.919 | 3.933 | 3.905 |
| Corrected daily model | 3.962 | 4.055 | 3.870 |

The 0.043 overall increase is too small to call a broad quality leap. The stronger writing subtotal and much better rough-to-polished result support retaining the corrected model, while the small synthesis decline identifies the next prompt improvement.

## House Style and Private Voice Review

The review used the private Kalen voice rubric, the House Style System, Penny's deterministic private-profile analysis, and the four specialized style review layers.

Key observations:

- Both voice-preservation outputs retained the required writing journey and protected faith and discernment language. The corrected output had one additional minor deterministic finding.
- The corrected rough-to-polished output improved Penny's deterministic private-profile score from 2 to 44 and reduced specialized style findings from 11-13 to 7. Absolute heuristic scores are calibration signals, not proof of authorship.
- The corrected style analysis had fewer surface-rule findings, but human review still caught AI-like categorical labels and a recommendation favoring short declarative pivots that conflicts with Kalen's current no-dramatic-punctuation rule.

## Next Evaluation Work

1. Keep these three cases as the stable historical comparison set.
2. Add one current synthetic or owner-approved short calibration case for the no-dramatic-punctuation and center-of-gravity rules.
3. Raise the style-analysis cap above 850 tokens or tighten the prompt so the checklist completes reliably; do not change both at once.
4. Run a blind A/B owner review for the two writing cases before treating the preliminary manual scores as final.
5. Do not move private source packets or raw outputs into Git. Only promote sanitized aggregate evidence such as this report.
