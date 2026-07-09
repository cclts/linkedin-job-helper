(() => {
  if (window.__linkedinJobHelperRepostLoaded) return;
  window.__linkedinJobHelperRepostLoaded = true;

  const CARD_CLASS = "ljh-reposted-job";
  const KNOWN_CLASS = "ljh-known-job";
  const JOB_VIEW_ID_RE = /\/jobs\/view\/(?:[^/?#]+-)?(\d+)(?:[/?#]|$)/;
  const COMPONENT_ID_RE = /job-card-component-ref-(\d+)/;
  let repostMap = {};
  let applyScheduled = false;
  let observerInstalled = false;

  const JOB_CARD_SELECTORS = [
    "li[data-occludable-job-id]",
    "li.jobs-search-results__list-item",
    "li.scaffold-layout__list-item",
    "li[data-view-name='job-card']",
    "[componentkey^='job-card-component-ref-'][role='button']",
    "div.job-card-container",
    "div.job-card-list",
    "div[data-job-id]"
  ];

  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        resolve(response || { ok: false, error: chrome.runtime.lastError?.message });
      });
    });
  }

  function visibleText(element) {
    return (element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function rectFor(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    };
  }

  function jobIdForCard(element) {
    const directId =
      element.getAttribute?.("data-occludable-job-id") ||
      element.getAttribute?.("data-job-id") ||
      element.querySelector?.("[data-job-id]")?.getAttribute("data-job-id") ||
      "";
    if (/^\d+$/.test(directId)) return directId;

    const componentKey = element.getAttribute?.("componentkey") || element.closest?.("[componentkey]")?.getAttribute("componentkey");
    const componentId = componentKey?.match(COMPONENT_ID_RE)?.[1] || "";
    if (componentId) return componentId;

    const link = element.querySelector?.("a[href*='/jobs/view/']") || element.closest?.("a[href*='/jobs/view/']");
    return link?.href?.match(JOB_VIEW_ID_RE)?.[1] || "";
  }

  function closestJobCard(element) {
    for (const selector of JOB_CARD_SELECTORS) {
      const card = element.closest?.(selector);
      if (card) return card;
    }
    return element;
  }

  function isLikelyResultCard(element) {
    const jobId = jobIdForCard(element);
    if (!jobId) return false;

    const rect = rectFor(element);
    const text = visibleText(element);
    const isLeftColumn = rect.x < Math.min(700, window.innerWidth * 0.6);
    const hasCardSize = rect.width >= 240 && rect.width <= 620 && rect.height >= 40 && rect.height <= 320;
    const hasJobText = /(easy apply|promoted|applicant|within the past|posted|school alum|actively reviewing|remote|on-site|hybrid)/i.test(text);

    return isLeftColumn && hasCardSize && hasJobText;
  }

  function uniqueElements(elements) {
    const seen = new Set();
    return elements.filter((element) => {
      if (seen.has(element)) return false;
      seen.add(element);
      return true;
    });
  }

  function findJobCards(root = document) {
    const selectorMatches = [...root.querySelectorAll(JOB_CARD_SELECTORS.join(","))];
    const linkMatches = [...root.querySelectorAll("a[href*='/jobs/view/']")].map(closestJobCard);
    return uniqueElements([...selectorMatches, ...linkMatches]).filter((element) => {
      return element && element !== document.body && element !== document.documentElement && isLikelyResultCard(element);
    });
  }

  function applyRepostState(root = document) {
    for (const candidate of findJobCards(root)) {
      const card = closestJobCard(candidate);
      const jobId = jobIdForCard(card);
      if (!jobId || !(jobId in repostMap)) continue;

      card.classList.add(KNOWN_CLASS);
      if (repostMap[jobId] === true) {
        card.classList.add(CARD_CLASS);
      } else {
        card.classList.remove(CARD_CLASS);
      }
    }
  }

  function scheduleApply() {
    if (applyScheduled) return;
    applyScheduled = true;
    window.requestAnimationFrame(() => {
      applyScheduled = false;
      applyRepostState();
    });
  }

  async function refreshRepostMap() {
    const response = await sendMessage({ type: "GET_REPOST_MAP" });
    if (!response.ok || !response.repostMap) return;
    repostMap = response.repostMap;
    scheduleApply();
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (event.data?.type !== "LJH_REPOST_DATA") return;

    const payload = event.data.payload;
    if (!payload || typeof payload !== "object") return;

    repostMap = { ...repostMap, ...payload };
    scheduleApply();

    sendMessage({ type: "MERGE_REPOST_DATA", payload })
      .then(() => refreshRepostMap())
      .catch(() => {});
  });

  function installObserver() {
    if (observerInstalled) return;
    if (!document.body) {
      window.setTimeout(installObserver, 50);
      return;
    }

    observerInstalled = true;
    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", scheduleApply, true);
  }

  function requestNetworkSync() {
    // Ask the MAIN-world capture script to replay data caught before this listener existed.
    window.postMessage({ type: "LJH_REPOST_REQUEST_SYNC" }, window.location.origin);
  }

  refreshRepostMap();
  installObserver();
  requestNetworkSync();
  window.setTimeout(requestNetworkSync, 500);
  window.setTimeout(requestNetworkSync, 2_000);
  scheduleApply();
})();
