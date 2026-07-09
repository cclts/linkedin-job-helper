(() => {
  if (window.__ljhRepostNetworkCaptureInstalled) return;
  window.__ljhRepostNetworkCaptureInstalled = true;

  const TARGET_PATTERN = /voyagerJobsDashJobCards/;
  const JOB_URN_RE = /(?:fsd_jobPosting|jobPosting):(\d+)/;
  const bufferedPayload = {};

  function jobIdFromUrn(value) {
    if (typeof value !== "string") return "";
    return value.match(JOB_URN_RE)?.[1] || "";
  }

  function extractJobId(node) {
    return jobIdFromUrn(node?.entityUrn) || jobIdFromUrn(node?.trackingUrn) || jobIdFromUrn(node?.dashEntityUrn);
  }

  function collectRepostFlags(node, output = {}) {
    if (!node || typeof node !== "object") return output;

    if (typeof node.repostedJob === "boolean") {
      const jobId = extractJobId(node);
      if (jobId) output[jobId] = node.repostedJob;
    }

    if (Array.isArray(node)) {
      for (const item of node) collectRepostFlags(item, output);
      return output;
    }

    for (const value of Object.values(node)) {
      collectRepostFlags(value, output);
    }
    return output;
  }

  function collectRepostFlagsFromText(text) {
    const output = {};
    const repostPattern = /"repostedJob"\s*:\s*(true|false)/g;
    let match;

    while ((match = repostPattern.exec(text))) {
      const isReposted = match[1] === "true";
      const start = text.lastIndexOf("{", match.index);
      const end = text.indexOf("}", match.index);
      if (start < 0 || end < 0) continue;

      const objectText = text.slice(start, end + 1);
      const jobId = objectText.match(/urn:li:(?:fsd_)?jobPosting:(\d+)/)?.[1] || "";

      if (jobId) output[jobId] = isReposted;
    }

    return output;
  }

  function publish(payload) {
    if (Object.keys(payload).length === 0) return;
    Object.assign(bufferedPayload, payload);
    // Bridge from the page's MAIN world to the isolated content script.
    window.postMessage({ type: "LJH_REPOST_DATA", payload }, window.location.origin);
  }

  function handleText(text) {
    if (typeof text !== "string" || !text.includes("repostedJob")) return;

    const fromText = collectRepostFlagsFromText(text);

    try {
      const payload = { ...fromText, ...collectRepostFlags(JSON.parse(text)) };
      publish(payload);
    } catch (_error) {
      publish(fromText);
    }
  }

  function decodeArrayBuffer(buffer) {
    try {
      return new TextDecoder("utf-8").decode(buffer);
    } catch (_error) {
      return "";
    }
  }

  async function readResponseTextForXhr(xhr) {
    try {
      if (typeof xhr.responseText === "string" && xhr.responseText.length > 0) {
        return xhr.responseText;
      }
    } catch (_error) {
      // responseText throws for Blob/ArrayBuffer responses; fall back below.
    }

    let response;
    try {
      response = xhr.response;
    } catch (_error) {
      return "";
    }

    if (typeof response === "string") {
      return response;
    }

    // LinkedIn's XHR wrapper may keep normalized JSON in Blob/ArrayBuffer form.
    if (response instanceof Blob) {
      try {
        return await response.text();
      } catch (_error) {
        return "";
      }
    }

    if (response instanceof ArrayBuffer) {
      return decodeArrayBuffer(response);
    }

    if (response && typeof response === "object") {
      try {
        return JSON.stringify(response);
      } catch (_error) {
        return "";
      }
    }

    return "";
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (event.data?.type !== "LJH_REPOST_REQUEST_SYNC") return;
    publish({ ...bufferedPayload });
  });

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = async function patchedFetch(...args) {
      const response = await originalFetch.apply(this, args);
      const url = String(args[0]?.url || args[0] || response.url || "");

      if (TARGET_PATTERN.test(url)) {
        response
          .clone()
          .text()
          .then(handleText)
          .catch(() => {});
      }

      return response;
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    this.__ljhRepostUrl = String(url || "");
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function patchedSend(...args) {
    if (TARGET_PATTERN.test(this.__ljhRepostUrl || "")) {
      const readOnce = () => {
        if (this.__ljhRepostRead || this.readyState !== 4) return;
        this.__ljhRepostRead = true;
        readResponseTextForXhr(this)
          .then(handleText)
          .catch(() => {});
      };

      this.addEventListener("readystatechange", readOnce);
      this.addEventListener("load", readOnce);
      this.addEventListener("loadend", readOnce);
    }

    return originalSend.apply(this, args);
  };
})();
