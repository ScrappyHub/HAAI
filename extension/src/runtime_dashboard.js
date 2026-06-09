"use strict";

const $ = (id) => document.getElementById(id);
let currentState = null;
let currentTimeline = [];
let activeTabSurface = null;

function set(id, value) {
  const el = $(id);
  if (el) { el.textContent = String(value ?? ""); }
}

function cls(id, value) {
  const el = $(id);
  if (el) { el.className = value; }
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

  if (u.includes("chatgpt.com") || u.includes("chat.openai.com")) { return "ChatGPT"; }
  if (u.includes("claude.ai")) { return "Claude"; }
  if (u.includes("gemini.google.com")) { return "Gemini"; }
  if (u.includes("grok.com") || u.includes("x.ai")) { return "Grok"; }
  if (u.includes("perplexity.ai")) { return "Perplexity"; }

  return "unknown";
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch (_) {
    return "";
  }
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }

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
function supportedProvider(provider) {
  const p = String(provider || "unknown").toLowerCase();
  return p !== "unknown" && p !== "-";
}

function niceProvider(surface) {
  const p = String(surface.provider || "").trim();
  if (p && supportedProvider(p)) { return p; }
  return surface.domain || "Unsupported site";
}

function lastSavedText(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return "No saved capture shown yet.";
  }
  const last = timeline[timeline.length - 1];
  return "Last saved: " + (last.stopped_utc || last.started_utc || "available");
}

function render(state, timeline) {
  const recordedSurface = state.surface || {};
  const surface = activeTabSurface || recordedSurface;
  const active = Boolean(state.active_capture);
  const supported = supportedProvider(surface.provider);
  const events = Array.isArray(state.events) ? state.events.length : 0;

  currentState = state;
  currentTimeline = Array.isArray(timeline) ? timeline : [];

  set("modePill", active ? "live" : (supported ? "ready" : "unsupported"));
  set("status", active ? "â— Recording" : (supported ? "â—‹ Ready" : "Unsupported Site"));
  cls("status", active ? "status live" : (supported ? "status ready" : "status bad"));

  set("site", supported ? niceProvider(surface) : (surface.domain || "Unsupported site"));
  set("title", supported ? (surface.title || "AI page detected") : "Open ChatGPT, Claude, Gemini, Grok, or another supported AI page.");
  set("messages", surface.message_count || 0);
  set("events", events);
  set("lastSaved", lastSavedText(currentTimeline));

  const primary = $("primaryAction");
  if (primary) {
    primary.disabled = !supported && !active;
    primary.textContent = active ? "Stop Recording" : "Start Recording";
    primary.className = active ? "stop" : "primary";
    if (!supported && !active) { primary.className = "primary disabled"; }
  }

  set("message", active
    ? "Recording now. Continue your AI session, then stop when finished."
    : supported
      ? "Ready to record this AI session."
      : "Recording is disabled on this page."
  );
}

async function refresh() {
  await loadActiveTabSurface();

  const response = await send({ type:"haai_get_state" });
  if (!response || response.ok === false) {
    set("status", "Needs Attention");
    cls("status", "status bad");
    set("message", "HAAI state failed: " + ((response && response.error) || "No response returned."));
    return;
  }
  render(response.state || response, response.timeline || []);
}

async function toggleRecording() {
  const state = currentState || {};
  const recordedSurface = state.surface || {};
  const surface = activeTabSurface || recordedSurface;
  const active = Boolean(state.active_capture);

  if (!active && !supportedProvider(surface.provider)) {
    set("message", "Open ChatGPT, Claude, Gemini, Grok, or another supported AI page first.");
    return;
  }

  const response = await send({ type: active ? "haai_stop_capture" : "haai_start_capture" });
  if (!response || response.ok === false) {
    set("message", "Recording action failed: " + ((response && response.error) || "No response returned."));
    return;
  }

  await refresh();
}

$("primaryAction").addEventListener("click", toggleRecording);

$("advancedToggle").addEventListener("click", () => {
  const panel = $("advanced");
  if (panel) { panel.classList.toggle("open"); }
});

$("openReplay").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/replay_center.html") });
});

$("openWorkbench").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/workbench.html") });
});

$("exportSession").addEventListener("click", async () => {
  set("message", "Exporting evidence...");
  const response = await send({ type:"haai_export_session" });
  if (!response || response.ok === false) {
    set("message", "Export failed: " + ((response && response.error) || "No response returned."));
    return;
  }
  set("message", "Exported. Check browser downloads.\n" + (response.filename || ""));
  await refresh();
});

$("buildPrompt").addEventListener("click", async () => {
  set("message", "Recovery prompt lives in Workbench. Open Advanced â†’ Workbench for full tools.");
});

refresh();
