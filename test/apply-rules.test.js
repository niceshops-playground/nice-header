import assert from "node:assert/strict";
import test from "node:test";

// Stub the whole extension surface applyRules touches BEFORE importing rules.js
// (it binds `browser` at import time).
let dynamicRules = [];
let updateCalls = [];
let badge = { text: null, color: null };
const sync = {};

globalThis.chrome = {
  storage: {
    sync: {
      get: async (k) => ({ [k]: sync[k] }),
      set: async (o) => Object.assign(sync, o)
    }
  },
  declarativeNetRequest: {
    getDynamicRules: async () => dynamicRules,
    updateDynamicRules: async ({ removeRuleIds, addRules }) => {
      updateCalls.push({ removeRuleIds, addRules });
      dynamicRules = addRules;
    }
  },
  action: {
    setBadgeText: async ({ text }) => {
      badge.text = text;
    },
    setBadgeBackgroundColor: async ({ color }) => {
      badge.color = color;
    }
  }
};

const { applyRules, loadState, saveState, STORAGE_KEY } = await import("../rules.js");

function reset() {
  dynamicRules = [];
  updateCalls = [];
  badge = { text: null, color: null };
  for (const k of Object.keys(sync)) delete sync[k];
}

function state({ headers = [], sources = [], urlRegex = ".*", masterEnabled = true } = {}) {
  return { urlRegex, masterEnabled, activeTab: "endpoint", headers, sources };
}

test("an enabled manual header becomes one set-header rule", async () => {
  reset();
  await applyRules(state({ headers: [{ name: "X-A", value: "1", enabled: true }] }));
  assert.equal(dynamicRules.length, 1);
  const rule = dynamicRules[0];
  assert.equal(rule.id, 1);
  assert.equal(rule.action.type, "modifyHeaders");
  assert.deepEqual(rule.action.requestHeaders, [{ header: "X-A", operation: "set", value: "1" }]);
  assert.equal(badge.text, "1");
  assert.equal(badge.color, "#F39200");
});

test("disabled and blank-named rows contribute nothing", async () => {
  reset();
  await applyRules(
    state({
      headers: [
        { name: "X-Off", value: "1", enabled: false },
        { name: "   ", value: "1", enabled: true }
      ]
    })
  );
  assert.deepEqual(dynamicRules, []);
  assert.equal(badge.text, "");
});

test("the master switch clears the rules without discarding the state", async () => {
  reset();
  const s = state({ headers: [{ name: "X-A", value: "1", enabled: true }] });
  await applyRules(s);
  assert.equal(dynamicRules.length, 1);
  await applyRules({ ...s, masterEnabled: false });
  assert.deepEqual(dynamicRules, []);
  assert.equal(badge.text, "");
});

test("active source rows are merged in alongside the manual ones", async () => {
  reset();
  await applyRules(
    state({
      headers: [{ name: "X-Manual", value: "m", enabled: true }],
      sources: [{ id: "s1", kind: "url", catalog: [{ name: "X-Src", value: "s", active: true }] }]
    })
  );
  assert.deepEqual(dynamicRules[0].action.requestHeaders.map((h) => h.header).sort(), [
    "X-Manual",
    "X-Src"
  ]);
  assert.equal(badge.text, "2");
});

test("inactive source rows are left out", async () => {
  reset();
  await applyRules(
    state({
      sources: [
        {
          id: "s1",
          kind: "url",
          catalog: [
            { name: "X-On", value: "1", active: true },
            { name: "X-Off", value: "1", active: false }
          ]
        }
      ]
    })
  );
  assert.deepEqual(dynamicRules[0].action.requestHeaders, [
    { header: "X-On", operation: "set", value: "1" }
  ]);
});

test("a manual header wins over a source header of the same name, case-insensitively", async () => {
  reset();
  await applyRules(
    state({
      headers: [{ name: "x-dup", value: "manual", enabled: true }],
      sources: [
        { id: "s1", kind: "url", catalog: [{ name: "X-Dup", value: "source", active: true }] }
      ]
    })
  );
  assert.deepEqual(dynamicRules[0].action.requestHeaders, [
    { header: "x-dup", operation: "set", value: "manual" }
  ]);
});

test("a source header with no manual twin survives the collision map", async () => {
  reset();
  await applyRules(
    state({
      headers: [{ name: "X-A", value: "1", enabled: true }],
      sources: [
        {
          id: "s1",
          kind: "url",
          catalog: [
            { name: "X-A", value: "shadowed", active: true },
            { name: "X-B", value: "kept", active: true }
          ]
        }
      ]
    })
  );
  const byHeader = new Map(dynamicRules[0].action.requestHeaders.map((h) => [h.header, h.value]));
  assert.equal(byHeader.get("X-A"), "1");
  assert.equal(byHeader.get("X-B"), "kept");
});

test("every previously installed rule id is removed on each apply", async () => {
  reset();
  dynamicRules = [{ id: 1 }, { id: 7 }];
  await applyRules(state({ headers: [{ name: "X-A", value: "1", enabled: true }] }));
  assert.deepEqual(updateCalls[0].removeRuleIds, [1, 7]);
});

test("a blank urlRegex falls back to matching everything", async () => {
  reset();
  await applyRules(
    state({ urlRegex: "   ", headers: [{ name: "X-A", value: "1", enabled: true }] })
  );
  assert.equal(dynamicRules[0].condition.regexFilter, ".*");
});

test("a configured urlRegex is trimmed and passed through", async () => {
  reset();
  await applyRules(
    state({ urlRegex: "  ^https://dev\\. ", headers: [{ name: "X-A", value: "1", enabled: true }] })
  );
  assert.equal(dynamicRules[0].condition.regexFilter, "^https://dev\\.");
});

test('a manual header with no value sends an empty string, not "undefined"', async () => {
  reset();
  await applyRules(state({ headers: [{ name: "X-Empty", enabled: true }] }));
  assert.equal(dynamicRules[0].action.requestHeaders[0].value, "");
});

test("state round-trips through sync storage and fills in the defaults", async () => {
  reset();
  const fresh = await loadState();
  assert.equal(fresh.urlRegex, ".*");
  assert.equal(fresh.masterEnabled, true);
  assert.equal(fresh.activeTab, "endpoint");
  assert.deepEqual(fresh.headers, []);
  assert.deepEqual(fresh.sources, []);

  await saveState({
    ...fresh,
    urlRegex: "^https://x/",
    headers: [{ name: "X-A", value: "1", enabled: true }]
  });
  const back = await loadState();
  assert.equal(back.urlRegex, "^https://x/");
  assert.equal(back.headers.length, 1);
  assert.equal(back.masterEnabled, true, "untouched keys still come from the defaults");
  assert.ok(sync[STORAGE_KEY], "written under the documented storage key");
});
