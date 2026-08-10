import { applyRules, loadState, STORAGE_KEY } from "./rules.js";

// Firefox exposes the promise-based WebExtension APIs on `browser`; Chrome (121+)
// exposes the same promise API on `chrome`. `browser ?? chrome` picks the
// promise-based namespace on either browser.
const browser = globalThis.browser ?? globalThis.chrome;

async function sync() {
  const state = await loadState();
  await applyRules(state);
}

browser.runtime.onInstalled.addListener(sync);
browser.runtime.onStartup.addListener(sync);

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes[STORAGE_KEY]) sync();
});
