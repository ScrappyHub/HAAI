"use strict";

const ids = {
  runtimeState: "runtimeState",
  captureRing: "captureRing",
  surfaceBadge: "surfaceBadge",
  providerValue: "providerValue",
  messagesValue: "messagesValue",
  inputValue: "inputValue",
  eventsValue: "eventsValue",
  domainValue: "domainValue",
  summaryCapture: "summaryCapture",
  summaryExports: "summaryExports",
  promptBox: "promptBox",
  timeline: "timeline",
  note: "note",
  nextStep: "nextStep",
  check: "check",
  probe: "probe",
  begin: "begin",
  stop: "stop",
  buildPrompt: "buildPrompt",
  copyPrompt: "copyPrompt",
  openWorkbench: "openWorkbench",
  openLegacyWorkbench: "openLegacyWorkbench",
  exportSession: "exportSession"
};

let lastRenderedState = null;

function node(name) {
  return document.getElementById(ids[name]);
}

function text(name, value) {
  const el = node(name);
  if (el) { el.textContent = String(value ?? ""); }
}

function click(name, handler) {
  const el = node(name);
  if (el) { el.addEventListener("click", handler); }
}

function setPrompt(value) {
  text("promptBox", value);
}

function setStateClass(active, supported) {
  const el = node("captureRing");
  if (!el) { return; }
  el.className = active ? "state good" : (supported ? "state off" : "state bad");
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: "No response returned." });
    });
  });
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const tab = tabs && tabs[0] ? tabs[0] : null;
      if (!tab || !tab.id) {
        reject(new Error("No active tab found."));
        return;
      }
      resolve(tab);
    });
  });
}

async function ensureContentScript(tabId) {
  try {
    if (chrome.scripting && chrome.scripting.executeScript) {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["src/content_script.js"]
      });
    }
  } catch (_) {}
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: "No response returned." });
    });
  });
}

function isSupportedProvider(provider) {
  const p = String(provider || "unknown").toLowerCase();
  return p !== "unknown" && p !== "-";
}

function pageAdvice(state) {
  const surface = state.surface || {};
  const active = Boolean(state.active_capture);
  const supported = isSupportedProvider(surface.provider);

  if (active) {
    return "Recording now. Continue the AI session, then export evidence when finished.";
  }

  if (!supported) {
    return "Open a supported AI page, then click Inspect or Probe. Recording is disabled here.";
  }

  if ((surface.message_count || 0) < 1) {
    return "Supported AI page detected. Start recording or interact with the AI to capture messages.";
  }

  return "Ready. Start recording to preserve this AI session as replay evidence.";
}

function summaryText(state, timeline) {
  const surface = state.surface || {};
  const lifecycle = state.lifecycle || {};
  const events = Array.isArray(state.events) ? state.events.length : 0;

  return [
    "Status: " + (state.active_capture ? "recording" : "not recording"),
    "Provider: " + (surface.provider || "unknown"),
    "Domain: " + (surface.domain || "-"),
    "Messages: " + (surface.message_count || 0),
    "Input: " + (surface.input_detected ? "detected" : "not detected"),
    "Events: " + events,
    "Exports: " + (lifecycle.exports || 0),
    "Saved captures: " + (Array.isArray(timeline) ? timeline.length : 0),
    "",
    pageAdvice(state)
  ].join("\n");
}

function renderTimeline(state) {
  const events = Array.isArray(state.events) ? state.events.slice(-4).reverse() : [];
  const el = node("timeline");
  if (!el) { return; }

  if (events.length === 0) {
    el.innerHTML = "";
    return;
  }

  el.innerHTML = events.map((event) => {
    const type = String(event.event_type || "event");
    const time = String(event.created_utc || event.utc || "");
    return '<div class="event"><b>' + escapeHtml(type) + '</b><span>' + escapeHtml(time) + '</span></div>';
  }).join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderState(state, timeline) {
  const surface = state.surface || {};
  const lifecycle = state.lifecycle || {};
  const events = Array.isArray(state.events) ? state.events.length : 0;
  const active = Boolean(state.active_capture);
  const supported = isSupportedProvider(surface.provider);

  lastRenderedState = state;

  text("captureRing", active ? "Recording" : (supported ? "Ready" : "Not recording"));
  text("runtimeState", active ? "LIVE" : (supported ? "Ready" : "Unsupported"));
  text("surfaceBadge", supported
    ? "Supported AI surface: " + (surface.domain || surface.provider || "unknown")
    : "Unsupported page: " + (surface.domain || "unknown"));
  text("nextStep", pageAdvice(state));
  text("providerValue", supported ? surface.provider : "Not AI");
  text("messagesValue", surface.message_count || 0);
  text("inputValue", surface.input_detected ? "Yes" : "No");
  text("eventsValue", events);
  text("domainValue", surface.domain || "-");
  text("summaryCapture", active ? "Recording" : (supported ? "Stopped" : "Unsupported"));
  text("summaryExports", lifecycle.exports || 0);

  setStateClass(active, supported);
  setPrompt(summaryText(state, timeline));
  renderTimeline(state);

  const begin = node("begin");
  if (begin) { begin.disabled = active || !supported; }

  const stop = node("stop");
  if (stop) { stop.disabled = !active; }

  text("note", active ? "Recording" : (supported ? "Ready" : "Waiting"));
}

async function refreshState() {
  text("note", "Checking");
  const response = await sendRuntimeMessage({ type: "haai_get_state" });

  if (!response || response.ok === false) {
    setPrompt("State refresh failed.\n\n" + ((response && response.error) || "No state returned."));
    text("note", "Review");
    return null;
  }

  const state = response.state || response;
  const timeline = response.timeline || [];

  renderState(state, timeline);
  return state;
}

click("check", async () => {
  await refreshState();
});

click("probe", async () => {
  text("note", "Probing");

  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);

    await sendTabMessage(tab.id, { type: "haai_probe_page" });
    await refreshState();
  } catch (err) {
    setPrompt("Probe failed.\n\n" + String(err && err.message ? err.message : err));
    text("note", "Probe failed");
  }
});

click("begin", async () => {
  const state = lastRenderedState || await refreshState();
  const surface = state && state.surface ? state.surface : {};

  if (!isSupportedProvider(surface.provider)) {
    setPrompt(
      "Recording was not started.\n\n" +
      "This is not a supported AI surface.\n\n" +
      "Current domain: " + (surface.domain || "-") + "\n\n" +
      "Open ChatGPT, Claude, Grok, or another supported AI page."
    );
    text("note", "Unsupported");
    return;
  }

  text("note", "Starting");

  const response = await sendRuntimeMessage({ type: "haai_start_capture" });

  if (!response || response.ok === false) {
    setPrompt("Capture start failed.\n\n" + ((response && response.error) || "No response returned."));
    text("note", "Start failed");
    return;
  }

  await refreshState();
});

click("stop", async () => {
  text("note", "Stopping");

  const response = await sendRuntimeMessage({ type: "haai_stop_capture" });

  if (!response || response.ok === false) {
    setPrompt("Capture stop failed.\n\n" + ((response && response.error) || "No response returned."));
    text("note", "Stop failed");
    return;
  }

  await refreshState();
});

click("buildPrompt", async () => {
  text("note", "Building");

  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);

    const response = await sendTabMessage(tab.id, { type: "haai_build_context_prompt" });

    if (!response || response.ok === false) {
      setPrompt("Context prompt failed.\n\n" + ((response && response.error) || "No response returned."));
      text("note", "Prompt failed");
      return;
    }

    setPrompt(response.prompt || "No prompt returned.");
    text("note", "Prompt ready");
  } catch (err) {
    setPrompt("Context prompt failed.\n\n" + String(err && err.message ? err.message : err));
    text("note", "Prompt failed");
  }
});

click("copyPrompt", async () => {
  try {
    await navigator.clipboard.writeText(node("promptBox") ? node("promptBox").textContent || "" : "");
    text("note", "Copied");
  } catch (_) {
    text("note", "Copy failed");
  }
});

click("openWorkbench", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/haai_runtime_viewer.html") });
});

click("openLegacyWorkbench", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/workbench.html") });
});

click("exportSession", async () => {
  text("note", "Exporting");

  const response = await sendRuntimeMessage({ type: "haai_export_session" });

  if (!response || response.ok === false) {
    setPrompt("Export failed.\n\n" + ((response && response.error) || "No response returned."));
    text("note", "Export failed");
    return;
  }

  setPrompt(
    "Evidence export created.\n\n" +
    "File: " + (response.filename || "-") + "\n" +
    "SHA-256: " + (response.sha256 || "-") + "\n\n" +
    "Check your browser downloads."
  );

  text("note", "Exported");
});

refreshState();
