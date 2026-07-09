(() => {
  const TOAST_CLASS = "ljh-toast";

  function showToast(message, isError = false) {
    document.querySelector(`.${TOAST_CLASS}`)?.remove();

    const toast = document.createElement("div");
    toast.className = `${TOAST_CLASS}${isError ? " ljh-toast-error" : ""}`;
    toast.textContent = message;
    document.documentElement.appendChild(toast);

    window.setTimeout(() => toast.remove(), 2200);
  }

  function visibleText(element) {
    return (element?.innerText || element?.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function rectFor(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      area: rect.width * rect.height
    };
  }

  function currentJobDescription() {
    const directSelectors = [
      ".jobs-description__content",
      ".jobs-description-content__text",
      ".jobs-box__html-content",
      "article.jobs-description__container",
      ".jobs-description"
    ];

    for (const selector of directSelectors) {
      const text = visibleText(document.querySelector(selector));
      if (/^about the job\b/i.test(text) && text.length > 400) {
        return text;
      }
    }

    return [...document.querySelectorAll("main section, main article, main div")]
      .map((element) => ({ rect: rectFor(element), text: visibleText(element) }))
      .filter(({ rect, text }) => {
        const isRightPane = rect.x > window.innerWidth * 0.35;
        const startsLikeDescription = /^about the job\b/i.test(text);
        const longEnough = text.length > 400;
        const notWholeDetailPane = !/(^|\n)(apply|save|job match|people you can reach out to)\b/i.test(text);
        return isRightPane && rect.width > 300 && rect.height > 80 && startsLikeDescription && longEnough && notWholeDetailPane;
      })
      .sort((a, b) => {
        const lengthDelta = a.text.length - b.text.length;
        return lengthDelta || a.rect.area - b.rect.area;
      })[0]?.text || "";
  }

  async function copyCurrentJobDescription() {
    const jd = currentJobDescription();
    if (!jd) {
      showToast("No job description found", true);
      return;
    }

    await navigator.clipboard.writeText(jd);
    showToast(`JD copied (${jd.length.toLocaleString()} chars)`);
    console.info("[LinkedIn Job Helper] JD copied", { chars: jd.length });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "COPY_JD") return false;

    copyCurrentJobDescription().catch((error) => {
      const reason = error.message || String(error);
      showToast(`Could not copy JD: ${reason}`, true);
      console.error("[LinkedIn Job Helper] clipboard copy failed", error);
    });

    return false;
  });

  window.__linkedinJobHelperCopyLoaded = true;
})();
