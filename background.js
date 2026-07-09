const REPOST_STORAGE_KEY = "ljhRepostMap";
let repostMap = {};
let hydrated = false;
let hydratePromise = null;

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "copy-jd" || !tab?.id) return;

  chrome.tabs.sendMessage(tab.id, { type: "COPY_JD" }).catch((error) => {
    console.error("[LinkedIn Job Helper] failed to send COPY_JD message", error);
  });
});

function hydrateRepostMap() {
  if (hydrated) return Promise.resolve();
  if (hydratePromise) return hydratePromise;

  hydratePromise = chrome.storage.local
    .get(REPOST_STORAGE_KEY)
    .then((result) => {
      const stored = result?.[REPOST_STORAGE_KEY];
      repostMap = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
      hydrated = true;
    })
    .catch((error) => {
      console.warn("[LinkedIn Job Helper] failed to hydrate repost map", error);
      repostMap = {};
      hydrated = true;
    });

  return hydratePromise;
}

function normalizeRepostPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};

  const normalized = {};
  for (const [jobId, isReposted] of Object.entries(payload)) {
    if (!/^\d+$/.test(jobId) || typeof isReposted !== "boolean") continue;
    normalized[jobId] = isReposted;
  }
  return normalized;
}

async function mergeRepostData(payload) {
  await hydrateRepostMap();

  const normalized = normalizeRepostPayload(payload);
  if (Object.keys(normalized).length === 0) {
    return { merged: 0, total: Object.keys(repostMap).length };
  }

  repostMap = { ...repostMap, ...normalized };
  await chrome.storage.local.set({ [REPOST_STORAGE_KEY]: repostMap });

  return {
    merged: Object.keys(normalized).length,
    total: Object.keys(repostMap).length
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "MERGE_REPOST_DATA") {
    mergeRepostData(message.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === "GET_REPOST_MAP") {
    hydrateRepostMap()
      .then(() => sendResponse({ ok: true, repostMap }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error), repostMap: {} }));
    return true;
  }

  return false;
});
