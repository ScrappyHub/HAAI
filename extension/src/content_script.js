const HAAI_CONTENT_MARK = "haai.content_script.v0_2";

function haaiNowIso() {
  return new Date().toISOString();
}

function haaiDetectAiSurface() {
  const raw = String(location.href || "") + " " + String(document.title || "");
  const s = raw.toLowerCase();

  const known = [
    { key: "chatgpt", label: "ChatGPT", needles: ["chatgpt.com", "chat.openai.com"] },
    { key: "claude", label: "Claude", needles: ["claude.ai"] },
    { key: "gemini", label: "Gemini", needles: ["gemini.google.com"] },
    { key: "perplexity", label: "Perplexity", needles: ["perplexity.ai"] },
    { key: "copilot", label: "Copilot", needles: ["copilot.microsoft.com"] },
    { key: "poe", label: "Poe", needles: ["poe.com"] },
    { key: "mistral", label: "Mistral", needles: ["chat.mistral.ai"] },
    { key: "grok", label: "Grok", needles: ["grok.com", "x.com/i/grok"] }
  ];

  for (const item of known) {
    if (item.needles.some((needle) => s.includes(needle))) {
      return item;
    }
  }

  return null;
}

function haaiPageSnapshot() {
  const text = (document.body && document.body.innerText ? document.body.innerText : "").slice(0, 12000);
  const inputs = Array.from(document.querySelectorAll("textarea, input[type='text'], [contenteditable='true']")).slice(0, 20).map((el) => {
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || "",
      ariaLabel: el.getAttribute("aria-label") || "",
      placeholder: el.getAttribute("placeholder") || "",
      valueLength: String(el.value || el.innerText || "").length
    };
  });

  return {
    url: location.href,
    title: document.title || "",
    capturedAt: haaiNowIso(),
    textLength: text.length,
    textPreview: text.slice(0, 2000),
    inputSurfaces: inputs
  };
}

async function haaiRecord(eventType, extra) {
  const detectedAiSurface = haaiDetectAiSurface();

  return await chrome.runtime.sendMessage({
    type: "haai_record_event",
    event: Object.assign({
      eventType,
      detectedAiSurface,
      page: {
        url: location.href,
        title: document.title || ""
      },
      snapshot: haaiPageSnapshot()
    }, extra || {})
  });
}

let haaiLastTextHash = "";

function haaiHashText(s) {
  let h = 0;
  const text = String(s || "");
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h) + text.charCodeAt(i);
    h |= 0;
  }
  return String(h);
}

async function haaiPollCapture() {
  try {
    const stateResp = await chrome.runtime.sendMessage({ type: "haai_get_state" });
    if (!stateResp || !stateResp.ok || !stateResp.state || !stateResp.state.active) {
      return;
    }

    const snapshot = haaiPageSnapshot();
    const sig = haaiHashText(snapshot.textPreview + "|" + snapshot.textLength + "|" + snapshot.title);

    if (sig !== haaiLastTextHash) {
      haaiLastTextHash = sig;
      await haaiRecord("page_snapshot_changed", { reason: "poll_change_detected" });
    }
  } catch (_err) {
  }
}

function haaiInstallInputListeners() {
  document.addEventListener("input", async (ev) => {
    const target = ev.target;
    if (!target) {
      return;
    }

    const tag = String(target.tagName || "").toLowerCase();
    const editable = target.isContentEditable || tag === "textarea" || tag === "input";

    if (!editable) {
      return;
    }

    const value = String(target.value || target.innerText || "");
    await haaiRecord("input_surface_changed", {
      input: {
        tag,
        valueLength: value.length,
        ariaLabel: target.getAttribute ? (target.getAttribute("aria-label") || "") : "",
        placeholder: target.getAttribute ? (target.getAttribute("placeholder") || "") : ""
      }
    });
  }, true);
}

async function haaiBuildContextPrompt() {
  const eventsResp = await chrome.runtime.sendMessage({ type: "haai_get_events" });
  const stateResp = await chrome.runtime.sendMessage({ type: "haai_get_state" });
  const snapshot = haaiPageSnapshot();
  const detected = haaiDetectAiSurface();

  const state = stateResp && stateResp.ok ? stateResp.state : null;
  const events = eventsResp && eventsResp.ok ? eventsResp.events : [];

  return [
    "HAAI Context Recovery Prompt",
    "",
    "Use this as verified local browser-context evidence. Do not treat this as proof of truth; treat it as captured session context.",
    "",
    "State:",
    JSON.stringify(state, null, 2),
    "",
    "Detected AI Surface:",
    JSON.stringify(detected, null, 2),
    "",
    "Current Page Snapshot:",
    JSON.stringify(snapshot, null, 2),
    "",
    "Recent Captured Events:",
    JSON.stringify(events.slice(-25), null, 2)
  ].join("\n");
}

if (!window[HAAI_CONTENT_MARK]) {
  window[HAAI_CONTENT_MARK] = true;
  haaiInstallInputListeners();
  setInterval(haaiPollCapture, 3000);

  chrome.runtime.sendMessage({
    type: "haai_detect_ai_surface",
    url: location.href,
    title: document.title || ""
  }, async (response) => {
    if (response && response.ok && response.detectedAiSurface) {
      await haaiRecord("content_script_ai_surface_ready", {
        detectedAiSurface: response.detectedAiSurface
      });
    }
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (!message || !message.type) {
      sendResponse({ ok: false, error: "HAAI_BAD_CONTENT_MESSAGE" });
      return;
    }

    if (message.type === "haai_ping_content") {
      sendResponse({
        ok: true,
        result: "content_script_ready",
        detectedAiSurface: haaiDetectAiSurface(),
        page: { url: location.href, title: document.title || "" }
      });
      return;
    }

    if (message.type === "haai_capture_probe") {
      const result = await haaiRecord("manual_capture_probe", { reason: "popup_probe" });
      sendResponse(Object.assign({ ok: true, result: "capture_probe_sent" }, { record: result }));
      return;
    }

    if (message.type === "haai_build_context_prompt") {
      const prompt = await haaiBuildContextPrompt();
      sendResponse({ ok: true, prompt });
      return;
    }

    sendResponse({ ok: false, error: "HAAI_UNKNOWN_CONTENT_MESSAGE", type: message.type });
  })().catch((err) => {
    sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
  });

  return true;
});
