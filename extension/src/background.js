const HAAI_STATE_KEY = "haai.capture.state.v1";

const DEFAULT_STATE = {
  schema: "haai.capture.state.v1",
  active: false,
  sessionId: null,
  startedAt: null,
  stoppedAt: null,
  eventCount: 0,
  lastEventAt: null,
  lastEventType: null,
  lastPage: null,
  detectedAiSurface: null
};

function nowIso() {
  return new Date().toISOString();
}

function makeSessionId() {
  return "haai-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

async function readState() {
  const found = await chrome.storage.local.get(HAAI_STATE_KEY);
  const state = found && found[HAAI_STATE_KEY] ? found[HAAI_STATE_KEY] : {};
  return Object.assign({}, DEFAULT_STATE, state);
}

async function writeState(state) {
  const clean = Object.assign({}, DEFAULT_STATE, state || {});
  await chrome.storage.local.set({ [HAAI_STATE_KEY]: clean });
  return clean;
}

async function publishState() {
  const state = await readState();
  try {
    chrome.runtime.sendMessage({ type: "haai_state_changed", state });
  } catch (_err) {
  }
  return state;
}

function detectAiSurface(url, title) {
  const raw = String(url || "") + " " + String(title || "");
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

async function appendEvent(event) {
  const state = await readState();
  if (!state.active) {
    return { ok: false, result: "capture_inactive" };
  }

  const next = Object.assign({}, state, {
    eventCount: Number(state.eventCount || 0) + 1,
    lastEventAt: nowIso(),
    lastEventType: event && event.eventType ? event.eventType : "unknown",
    lastPage: event && event.page ? event.page : state.lastPage,
    detectedAiSurface: event && event.detectedAiSurface ? event.detectedAiSurface : state.detectedAiSurface
  });

  await writeState(next);

  const key = "haai.capture.events." + next.sessionId;
  const found = await chrome.storage.local.get(key);
  const events = Array.isArray(found[key]) ? found[key] : [];
  events.push(Object.assign({
    schema: "haai.capture.event.v1",
    sessionId: next.sessionId,
    recordedAt: nowIso()
  }, event || {}));

  await chrome.storage.local.set({ [key]: events.slice(-500) });

  return { ok: true, result: "event_recorded", state: next };
}

async function beginCapture(sender) {
  const current = await readState();

  if (current.active) {
    return { ok: true, result: "capture_already_active", state: current };
  }

  const tab = sender && sender.tab ? sender.tab : null;
  const detected = tab ? detectAiSurface(tab.url, tab.title) : null;

  const next = Object.assign({}, DEFAULT_STATE, {
    active: true,
    sessionId: makeSessionId(),
    startedAt: nowIso(),
    stoppedAt: null,
    eventCount: 0,
    lastEventAt: null,
    lastEventType: "capture_started",
    lastPage: tab ? { url: tab.url || "", title: tab.title || "" } : null,
    detectedAiSurface: detected
  });

  await writeState(next);
  await publishState();

  return { ok: true, result: "capture_started", state: next };
}

async function stopCapture() {
  const current = await readState();

  if (!current.active) {
    return { ok: true, result: "capture_already_inactive", state: current };
  }

  const next = Object.assign({}, current, {
    active: false,
    stoppedAt: nowIso(),
    lastEventAt: nowIso(),
    lastEventType: "capture_stopped"
  });

  await writeState(next);
  await publishState();

  return { ok: true, result: "capture_stopped", state: next };
}

async function getEvents() {
  const state = await readState();
  if (!state.sessionId) {
    return { ok: true, events: [], state };
  }

  const key = "haai.capture.events." + state.sessionId;
  const found = await chrome.storage.local.get(key);
  const events = Array.isArray(found[key]) ? found[key] : [];
  return { ok: true, events, state };
}

chrome.runtime.onInstalled.addListener(async () => {
  const state = await readState();
  await writeState(state);
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") {
    return;
  }

  const detected = detectAiSurface(tab.url, tab.title);
  if (!detected) {
    return;
  }

  const state = await readState();
  if (!state.active) {
    await writeState(Object.assign({}, state, {
      detectedAiSurface: detected,
      lastPage: { url: tab.url || "", title: tab.title || "" },
      lastEventAt: nowIso(),
      lastEventType: "ai_surface_detected"
    }));
    await publishState();
    return;
  }

  await appendEvent({
    eventType: "ai_surface_detected",
    detectedAiSurface: detected,
    page: { url: tab.url || "", title: tab.title || "" }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || !message.type) {
      sendResponse({ ok: false, error: "HAAI_BAD_MESSAGE" });
      return;
    }

    if (message.type === "haai_get_state") {
      sendResponse({ ok: true, state: await readState() });
      return;
    }

    if (message.type === "haai_begin_capture") {
      sendResponse(await beginCapture(sender));
      return;
    }

    if (message.type === "haai_stop_capture") {
      sendResponse(await stopCapture());
      return;
    }

    if (message.type === "haai_record_event") {
      sendResponse(await appendEvent(message.event || {}));
      return;
    }

    if (message.type === "haai_get_events") {
      sendResponse(await getEvents());
      return;
    }

    if (message.type === "haai_detect_ai_surface") {
      const detected = detectAiSurface(message.url || "", message.title || "");
      sendResponse({ ok: true, detectedAiSurface: detected });
      return;
    }

    sendResponse({ ok: false, error: "HAAI_UNKNOWN_MESSAGE_TYPE", type: message.type });
  })().catch((err) => {
    sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
  });

  return true;
});
