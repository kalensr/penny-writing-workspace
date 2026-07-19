# Gemma 4 And MLX Reference Setup

This is the tested companion runtime for Penny's local Gemma 4 reference
setup. It is an optional runtime, not a bundled Penny dependency, a minimum
hardware specification, or a promise about speed. Penny can also use another
approved loopback chat-completions endpoint.

## The Two Model Roles

| Profile | Model | Use in Penny | Generation settings |
| --- | --- | --- | --- |
| Daily | [Gemma 4 26B-A4B Unsloth UD MLX 4-bit](https://huggingface.co/unsloth/gemma-4-26b-a4b-it-UD-MLX-4bit), pinned to `ea6005b2a9b3dda91bcb26cb94a6ddf3a2eea4df` | Drafting, revision, and routine critique | 1,200 tokens, temperature 0.35, top-p 0.9 |
| Quality | [Gemma 4 31B](https://huggingface.co/mlx-community/gemma-4-31B-it-qat-OptiQ-4bit) | A slower second-reader pass for deliberate review | 1,600 tokens, temperature 0.30, top-p 0.9 |

The Daily model is a mixture-of-experts Gemma 4 model. The Quality model is a
dense Gemma 4 model. Google describes the 26B-A4B model as a higher-throughput
option and the 31B model as a dense model that can bridge local execution and
server-grade work. See the [Gemma 4 overview](https://ai.google.dev/gemma/docs/core)
and [model card](https://ai.google.dev/gemma/docs/core/model_card_4) for the
architecture, model capabilities, and current memory guidance.

The companion runtime starts one model profile at a time. Penny uses the Daily
profile for its normal writing modes and switches to Quality for the
quality-review mode. The current reference configuration disables model
thinking for both profiles so that the writing workflow stays direct and
predictable.

## Tested Hardware And Runtime

The reference machine is a Mac Studio with an Apple M4 Max, a 14-core CPU, a
32-core GPU, and 36 GB of unified memory. The observed runtime uses MLX 0.31.2
and MLX-LM 0.31.3. MLX is built for Apple silicon and uses unified memory across
the CPU and GPU; MLX-LM supplies the local chat-completions endpoint Penny
calls. See [MLX](https://github.com/ml-explore/mlx) and
[MLX-LM](https://github.com/ml-explore/mlx-lm).

Google's published Q4 estimates are useful planning inputs, not capacity
guarantees: 14.4 GB for Gemma 4 26B-A4B and 17.5 GB for Gemma 4 31B before
context and runtime overhead. Keep prompts and generated output bounded, and
test the actual model, quantization, and context length on the machine you use.

## Proven Installation Path

The tested setup uses a dedicated Python 3.12 environment, MLX-LM, local model
snapshots, and a loopback-only server. It does not install MLX-LM globally.

```sh
uv venv --python python3.12 .venv-mlx
uv pip install --python .venv-mlx/bin/python 'mlx-lm>=0.30.7'
.venv-mlx/bin/mlx_lm.server --help
```

Download the selected model from its linked model page into local storage. The
tested runtime starts a downloaded local snapshot, rather than fetching a model
for each request. Set `MODEL_PATH` to that snapshot's directory and start the
profile you want:

```sh
HF_HUB_OFFLINE=1 .venv-mlx/bin/python -m mlx_lm.server \
  --model "$MODEL_PATH" \
  --host 127.0.0.1 \
  --port 8091 \
  --max-tokens 1200 \
  --temp 0.35 \
  --top-p 0.9 \
  --decode-concurrency 1 \
  --prompt-concurrency 1 \
  --chat-template-args '{"enable_thinking":false}'
```

For the Quality profile, use the 31B model snapshot with `--max-tokens 1600`,
`--temp 0.30`, and the same loopback and concurrency settings. Then start
Penny with its default local endpoint:

```sh
npm run server
```

The model and MLX projects change quickly. Check the selected model card and
the current MLX-LM documentation before reproducing this setup. Penny does not
install, download, or expose model files for you.

## Boundaries

- The reference setup is for a single local writing workflow, not a multi-user
  hosted model service.
- Keep MLX-LM bound to loopback. Its own server documentation describes the API
  as OpenAI-like and advises against treating it as a production server.
- A model suggestion remains separate from the draft until the writer applies
  it in Penny.
- Hardware, quantization, model updates, context length, and other running
  applications all affect real memory use and response time.
