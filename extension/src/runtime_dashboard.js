"use strict";

const ids = {
  runtimeState: "runtimeState",
  captureRing: "captureRing",
  surfaceBadge: "surfaceBadge",
  providerBadge: "providerBadge",
  domainValue: "domainValue",
  messagesValue: "messagesValue",
  inputValue: "inputValue",
  eventsValue: "eventsValue",
  captureLine: "captureLine",
  sessionId: "sessionId",
  summaryCapture: "summaryCapture",
  summaryMessages: "summaryMessages",
  summaryEvents: "summaryEvents",
  summaryDomainChanges: "summaryDomainChanges",
  summaryConversationChanges: "summaryConversationChanges",
  summaryExports: "summaryExports",
  promptBox: "promptBox",
  timeline: "timeline",
  note: "note",
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

function node(name) {
  return document.getElementById(ids[name]);
}

function text(name, value) {
  const el = node(name);
  if (el) { el.textContent = String(value ?? ""); }
}

function html(name, value) {
  const el = node(name);
  if (el) { el.innerHTML = value; }
}

function click(name, handler) {
  const el = node(name);
  if (el) { el.addEventListener("click", handler); }
}

function setPrompt(value) {
  text("promptBox", value);
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

function summaryText(state, timeline) {
  const surface = state.surface || {};
  const lifecycle = state.lifecycle || {};
  const events = Array.isArray(state.events) ? state.events.length : 0;
  const captures = Array.isArray(timeline) ? timeline.length : 0;

  return [
    "HAAI session summary",
    "",
    "Capture: " + (state.active_capture ? "running" : "stopped"),
    "Provider: " + (surface.provider || "unknown"),
    "Domain: " + (surface.domain || "-"),
    "Title: " + (surface.title || "-"),
    "Visible messages: " + (surface.message_count || 0),
    "Input detected: " + (surface.input_detected ? "yes" : "no"),
    "Recorded events: " + events,
    "Domain changes: " + (lifecycle.domain_changes || 0),
    "Conversation changes: " + (lifecycle.conversation_changes || 0),
    "Exports: " + (lifecycle.exports || 0),
    "",
    "Captured sessions: " + captures,
    "",
    "Technical evidence stays available in Workbench."
  ].join("\n");
}

function renderTimeline(state) {
  const events = Array.isArray(state.events) ? state.events.slice(-6).reverse() : [];

  if (events.length === 0) {
    html("timeline", '<div class="eventRow"><b>No events loaded yet</b><span>Click Inspect Surface</span></div>');
    return;
  }

  html("timeline", events.map((event) => {
    const type = event.event_type || "event";
    const time = event.created_utc || event.utc || "";
    return '<div class="eventRow"><b>' + escapeHtml(type) + '</b><span>' + escapeHtml(time) + '</span></div>';
  }).join(""));
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

  text("runtimeState", active ? "Capturing" : "Ready");
  text("captureRing", active ? "Capturing" : "Inactive");
  const ring = node("captureRing");
  if (ring) { ring.className = active ? "state" : "state off"; }
  text("surfaceBadge", "Surface: " + (surface.domain || surface.provider || "unknown"));
  text("providerValue", surface.provider || "unknown");
  text("domainValue", surface.domain || "-");
  text("messagesValue", surface.message_count || 0);
  text("inputValue", surface.input_detected ? "Yes" : "No");
  text("eventsValue", events);
  text("captureLine", active ? "Capture running" : "Capture stopped");
  text("sessionId", state.session_id || "-");

  text("summaryCapture", active ? "Running" : "Stopped");
  text("summaryMessages", surface.message_count || 0);
  text("summaryEvents", events);
  text("summaryDomainChanges", lifecycle.domain_changes || 0);
  text("summaryConversationChanges", lifecycle.conversation_changes || 0);
  text("summaryExports", lifecycle.exports || 0);

  setPrompt(summaryText(state, timeline));
  renderTimeline(state);
}

async function refreshState() {
  text("note", "Refreshing");

  const response = await sendRuntimeMessage({ type: "haai_get_state" });

  if (!response || response.ok === false) {
    setPrompt("State refresh failed.\n\n" + ((response && response.error) || "No state returned."));
    text("note", "Review");
    return null;
  }

  const state = response.state || response;
  const timeline = response.timeline || [];

  renderState(state, timeline);
  text("note", "Ready");

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

    const response = await sendTabMessage(tab.id, { type: "haai_probe_page" });

    if (!response || response.ok === false) {
      await refreshState();
      text("note", "Probe fallback");
      return;
    }

    setPrompt(
      "Page probe complete.\n\n" +
      "Provider: " + (response.provider || "unknown") + "\n" +
      "Domain: " + (response.domain || "-") + "\n" +
      "Messages: " + (response.message_count || 0)
    );

    await refreshState();
    text("note", "Ready");
  } catch (err) {
    setPrompt("Probe failed.\n\n" + String(err && err.message ? err.message : err));
    text("note", "Probe failed");
  }
});

click("begin", async () => {
  text("note", "Starting");

    const current = await sendRuntimeMessage({ type: "haai_get_state" });
  const currentState = current && current.state ? current.state : current;
  const surface = currentState && currentState.surface ? currentState.surface : {};
  const provider = String(surface.provider || "unknown").toLowerCase();

  if (provider === "unknown") {
    setPrompt(
      "Capture was not started.\n\n" +
      "The current page is not recognized as an AI surface.\n\n" +
      "Detected domain: " + (surface.domain || "-") + "\n\n" +
      "Open ChatGPT, Grok, Claude, or another supported AI page, then click Inspect or Probe."
    );
    text("note", "Not an AI surface");
    await refreshState();
    return;
  }

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

  setPrompt("Session export ready.\n\nFile: " + (response.filename || "-") + "\nSHA-256: " + (response.sha256 || "-"));
  text("note", "Export ready");
});

refreshState();
