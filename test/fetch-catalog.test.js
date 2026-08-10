import assert from "node:assert/strict";
import test from "node:test";

globalThis.chrome = {
  storage: { sync: { get: async () => ({}), set: async () => {} } },
  declarativeNetRequest: { getDynamicRules: async () => [], updateDynamicRules: async () => {} },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} }
};

const { fetchCatalog } = await import("../rules.js");

const realFetch = globalThis.fetch;

function stubFetch(impl) {
  globalThis.fetch = impl;
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test("a JSON endpoint is normalized into catalog rows", async () => {
  let seen;
  stubFetch(async (url, init) => {
    seen = { url, init };
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ headers: [{ name: "X-A" }] })
    };
  });
  const { headers, dropped } = await fetchCatalog(" https://example.test/flags ");
  assert.deepEqual(headers, [{ name: "X-A", value: "1" }]);
  assert.equal(dropped, 0);
  assert.equal(seen.url, "https://example.test/flags", "the URL is trimmed before the request");
  assert.equal(seen.init.headers.Accept, "application/json");
  assert.equal(seen.init.cache, "no-store", "a stale cached catalog would be worse than none");
});

test("an unset URL is reported before any request goes out", async () => {
  let called = false;
  stubFetch(async () => {
    called = true;
  });
  for (const url of [undefined, null, "", "   "]) {
    await assert.rejects(() => fetchCatalog(url), /No endpoint URL configured/);
  }
  assert.equal(called, false);
});

test("a transport failure is reported as a URL/permission problem, not a stack trace", async () => {
  stubFetch(async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(
    () => fetchCatalog("https://example.test/flags"),
    /check the URL and host permissions/
  );
});

test("a non-2xx response surfaces its status", async () => {
  stubFetch(async () => ({
    ok: false,
    status: 404,
    statusText: "Not Found",
    json: async () => ({})
  }));
  await assert.rejects(() => fetchCatalog("https://example.test/flags"), /HTTP 404 Not Found/);
});

test("a non-JSON body is reported as such", async () => {
  stubFetch(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => {
      throw new SyntaxError("Unexpected token <");
    }
  }));
  await assert.rejects(() => fetchCatalog("https://example.test/flags"), /not valid JSON/);
});

test("valid JSON of the wrong shape still fails the catalog contract", async () => {
  stubFetch(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ flags: [] })
  }));
  await assert.rejects(
    () => fetchCatalog("https://example.test/flags"),
    /Expected \{ "headers": \[/
  );
});
