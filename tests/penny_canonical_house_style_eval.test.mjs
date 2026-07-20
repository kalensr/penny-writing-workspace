import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalSuites, runCanonicalSuites } from "../scripts/run-canonical-house-style-evals.mjs";

test("canonical voice evaluation owns all optional layers", () => {
  assert.deepEqual(canonicalSuites, [
    "scripts/eval-kalen-voice.sh",
    "scripts/eval-ai-voice.sh",
    "scripts/eval-center-of-gravity.sh",
    "scripts/eval-dramatic-punctuation.sh",
  ]);
});

test("canonical voice evaluation fails closed when its source is absent", () => {
  assert.throws(() => runCanonicalSuites("/private/tmp/missing-house-style-system"), /suite is missing/);
});
