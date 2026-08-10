import assert from "node:assert/strict";
import test from "node:test";

globalThis.chrome = {
  storage: { sync: { get: async () => ({}), set: async () => {} } },
  declarativeNetRequest: { getDynamicRules: async () => [], updateDynamicRules: async () => {} },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} }
};

const { mergeCatalog, newSource } = await import("../rules.js");

test("a refetch keeps the rows the user had switched on", () => {
  const prev = [
    { name: "X-A", value: "old", active: true },
    { name: "X-B", value: "old", active: false }
  ];
  const merged = mergeCatalog(prev, [
    { name: "X-A", value: "new" },
    { name: "X-B", value: "new" }
  ]);
  assert.deepEqual(merged, [
    { name: "X-A", value: "new", active: true },
    { name: "X-B", value: "new", active: false }
  ]);
});

test("values are source-authoritative — the endpoint overwrites what was stored", () => {
  const merged = mergeCatalog(
    [{ name: "X-A", value: "stale", active: true }],
    [{ name: "X-A", value: "fresh" }]
  );
  assert.equal(merged[0].value, "fresh");
});

test("a header the endpoint newly introduced starts switched off", () => {
  const merged = mergeCatalog(
    [{ name: "X-A", value: "1", active: true }],
    [
      { name: "X-A", value: "1" },
      { name: "X-New", value: "1" }
    ]
  );
  assert.equal(merged.find((h) => h.name === "X-New").active, false);
});

test("a header the endpoint dropped disappears instead of lingering", () => {
  const merged = mergeCatalog(
    [
      { name: "X-Gone", value: "1", active: true },
      { name: "X-Stay", value: "1", active: true }
    ],
    [{ name: "X-Stay", value: "1" }]
  );
  assert.deepEqual(
    merged.map((h) => h.name),
    ["X-Stay"]
  );
});

test("no previous catalog is not an error — everything starts off", () => {
  for (const prev of [undefined, null, []]) {
    const merged = mergeCatalog(prev, [{ name: "X-A", value: "1" }]);
    assert.deepEqual(merged, [{ name: "X-A", value: "1", active: false }]);
  }
});

test("matching is by exact name, so case differences are treated as distinct headers", () => {
  const merged = mergeCatalog(
    [{ name: "x-a", value: "1", active: true }],
    [{ name: "X-A", value: "1" }]
  );
  assert.equal(merged[0].active, false);
});

test("a fresh source is empty, unsynced and carries a unique id", () => {
  const a = newSource("url");
  const b = newSource("file");
  assert.equal(a.kind, "url");
  assert.equal(b.kind, "file");
  for (const s of [a, b]) {
    assert.deepEqual(s.catalog, []);
    assert.equal(s.url, "");
    assert.equal(s.fileName, "");
    assert.equal(s.syncedAt, null);
    assert.equal(s.error, null);
    assert.match(s.id, /^s/);
  }
  assert.notEqual(a.id, b.id);
});
