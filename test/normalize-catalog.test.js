import assert from "node:assert/strict";
import test from "node:test";

// rules.js binds `browser` at import time, so the namespace has to exist before the
// import — even for the pure functions exercised here.
globalThis.chrome = {
  storage: { sync: { get: async () => ({}), set: async () => {} } },
  declarativeNetRequest: { getDynamicRules: async () => [], updateDynamicRules: async () => {} },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} }
};

const { normalizeCatalog } = await import("../rules.js");

test("a well-formed response passes through untouched", () => {
  const { headers, dropped } = normalizeCatalog({
    headers: [
      { name: "X-Feature-A", value: "on" },
      { name: "X-Feature-B", value: "off" }
    ]
  });
  assert.deepEqual(headers, [
    { name: "X-Feature-A", value: "on" },
    { name: "X-Feature-B", value: "off" }
  ]);
  assert.equal(dropped, 0);
});

test('a missing value defaults to "1" — the flag-style shorthand', () => {
  const { headers } = normalizeCatalog({
    headers: [{ name: "X-Flag" }, { name: "X-Null", value: null }]
  });
  assert.deepEqual(headers, [
    { name: "X-Flag", value: "1" },
    { name: "X-Null", value: "1" }
  ]);
});

test("non-string values are stringified rather than dropped", () => {
  const { headers } = normalizeCatalog({
    headers: [
      { name: "X-Num", value: 42 },
      { name: "X-Bool", value: false }
    ]
  });
  assert.deepEqual(headers, [
    { name: "X-Num", value: "42" },
    { name: "X-Bool", value: "false" }
  ]);
});

test("names are trimmed", () => {
  const { headers } = normalizeCatalog({ headers: [{ name: "  X-Padded  ", value: "1" }] });
  assert.equal(headers[0].name, "X-Padded");
});

test("rows without a usable name are counted as dropped, not thrown", () => {
  const { headers, dropped } = normalizeCatalog({
    headers: [{ name: "X-Keep" }, { name: "   " }, { name: 7 }, {}, null]
  });
  assert.deepEqual(
    headers.map((h) => h.name),
    ["X-Keep"]
  );
  assert.equal(dropped, 4);
});

test("a bad top-level shape throws with the expected shape in the message", () => {
  for (const bad of [null, undefined, {}, { headers: "nope" }, [], { headers: null }]) {
    assert.throws(() => normalizeCatalog(bad), /Expected \{ "headers": \[/);
  }
});

test("an empty header list is valid — it just clears the catalog", () => {
  const { headers, dropped } = normalizeCatalog({ headers: [] });
  assert.deepEqual(headers, []);
  assert.equal(dropped, 0);
});
