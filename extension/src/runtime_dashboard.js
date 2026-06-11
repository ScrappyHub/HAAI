"use strict";

const $ = (id) => document.getElementById(id);

let currentState = {};
let currentTimeline = [];
let activeTabSurface = null;

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = String(value ?? "");
}

function setClass(id, value) {
  const el = $(id);
  if (el) el.className = value;
}

function downloadText(filename, body, mimeType) {
  const blob = new Blob([body || ""], { type: mimeType || "application/json" });
  const url = URL.createObjectURL(blob);

  chrome.downloads.download({
    url: url,
    filename: filename || "haai_session_export.json",
    saveAs: true
  }, () => {
    try { URL.revokeObjectURL(url); } catch (_) {}
  });
}

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok:false, error:chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok:false, error:"No response returned." });
    });
  });
}

function providerFromUrl(url) {
  const u = String(url || "").toLowerCase();
  if (u.includes("chatgpt.com") || u.includes("chat.openai.com")) return "ChatGPT";
  if (u.includes("claude.ai")) return "Claude";
  if (u.includes("gemini.google.com")) return "Gemini";
  if (u.includes("grok.com") || u.includes("x.ai")) return "Grok";
  if (u.includes("perplexity.ai")) return "Perplexity";
  return "unknown";
}

function domainFromUrl(url) {
  try { return new URL(url).hostname; } catch (_) { return ""; }
}

function supportedProvider(provider) {
  const p = String(provider || "unknown").toLowerCase();
  return p !== "unknown" && p !== "-";
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active:true, currentWindow:true }, (tabs) => {
      if (chrome.runtime.lastError) { resolve(null); return; }
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

async function loadActiveTabSurface() {
  const tab = await getActiveTab();
  if (!tab) {
    activeTabSurface = null;
    return null;
  }

  activeTabSurface = {
    provider: providerFromUrl(tab.url || ""),
    domain: domainFromUrl(tab.url || ""),
    title: tab.title || "",
    url: tab.url || ""
  };

  return activeTabSurface;
}

function lastSavedText(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) return "No saved capture shown yet.";
  const last = timeline[timeline.length - 1];
  const raw = last.stopped_utc || last.started_utc || "";
  if (!raw) return "Last saved capture available.";
  try { return "Last saved: " + new Date(raw).toLocaleString(); }
  catch (_) { return "Last saved: " + raw; }
}

function render(state, timeline) {
  const recordedSurface = state && state.surface ? state.surface : {};
  const surface = activeTabSurface || recordedSurface;
  const isActive = Boolean(state && state.active_capture);
  const isSupported = supportedProvider(surface.provider);
  const eventCount = state && Array.isArray(state.events) ? state.events.length : 0;

  currentState = state || {};
  currentTimeline = Array.isArray(timeline) ? timeline : [];

  setText("modePill", isActive ? "live" : (isSupported ? "ready" : "unsupported"));
  setText("status", isActive ? "Recording" : (isSupported ? "Ready" : "Unsupported Site"));
  setClass("status", isActive ? "status live" : (isSupported ? "status ready" : "status bad"));

  setText("site", isSupported ? surface.provider : (surface.domain || "Unsupported site"));

  const activeTitle = activeTabSurface && activeTabSurface.title ? activeTabSurface.title : "";
  const cleanTitle = String(surface.title || activeTitle || "").trim();
  setText("title", cleanTitle && cleanTitle.toLowerCase() !== "haai"
    ? cleanTitle
    : (isSupported ? "AI page detected" : "Open ChatGPT, Claude, Gemini, Grok, or another supported AI page.")
  );

  setText("messages", recordedSurface.message_count || 0);
  setText("events", eventCount);
  setText("lastSaved", lastSavedText(currentTimeline));

  const primary = $("primaryAction");
  if (primary) {
    primary.disabled = !isSupported && !isActive;
    primary.textContent = isActive ? "Stop Recording" : "Start Recording";
    primary.className = isActive ? "stop" : "primary";
    if (!isSupported && !isActive) primary.className = "primary disabled";
  }

  setText("message", isActive
    ? "Recording now. Continue your AI session, then stop when finished."
    : isSupported
      ? "Ready to record this AI session."
      : "Recording is disabled on this page."
  );
}

async function refresh() {
  await loadActiveTabSurface();
  const response = await send({ type:"haai_get_state" });
  if (!response || response.ok === false) {
    setText("status", "Needs Attention");
    setClass("status", "status bad");
    setText("message", "HAAI state failed: " + ((response && response.error) || "No response returned."));
    return;
  }
  render(response.state || response, response.timeline || []);
}

async function toggleRecording() {
  await loadActiveTabSurface();

  const surface = activeTabSurface || {};
  const isActive = Boolean(currentState && currentState.active_capture);

  if (!isActive && !supportedProvider(surface.provider)) {
    setText("message", "Open ChatGPT, Claude, Gemini, Grok, or another supported AI page first.");
    return;
  }

  const response = await send({ type: isActive ? "haai_stop_capture" : "haai_begin_capture" });

  if (!response || response.ok === false) {
    setText("message", "Recording action failed: " + ((response && response.error) || "No response returned."));
    return;
  }

  await refresh();
}

function bind(id, fn) {
  const el = $(id);
  if (el) el.addEventListener("click", fn);
}

bind("primaryAction", toggleRecording);

bind("advancedToggle", () => {
  const panel = $("advanced");
  if (panel) panel.classList.toggle("open");
});

bind("openReplay", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/replay_center.html") });
});

bind("exportSession", async () => {
  setText("message", "Exporting evidence...");
  const response = await send({ type:"haai_export_session" });

  if (!response || response.ok === false) {
    setText("message", "Export failed: " + ((response && response.error) || "No response returned."));
    return;
  }

  if (response.body) {
    downloadText(response.filename || "haai_session_export.json", response.body, "application/json");
    setText("message", "Export download started.\n" + (response.filename || ""));
  } else {
    setText("message", "Export created, but no file body was returned.");
  }
  await refresh();
});

refresh();
