import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizePublicBasePath } from "../app/vite.config.js";

test("Penny Vite build uses relative assets by default", () => {
  assert.equal(normalizePublicBasePath(""), "./");
});

test("Penny Vite build normalizes a public path prefix for Tailscale path mode", () => {
  assert.equal(normalizePublicBasePath("penny"), "/penny/");
  assert.equal(normalizePublicBasePath("/penny"), "/penny/");
  assert.equal(normalizePublicBasePath("/penny/"), "/penny/");
});
