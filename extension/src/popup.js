"use strict";

const captureBadge = document.getElementById("captureBadge");
const surfaceBadge = document.getElementById("surfaceBadge");
const metaLine = document.getElementById("metaLine");
const promptBox = document.getElementById("promptBox");
const note = document.getElementById("note");

const checkButton = document.getElementById("check");
const probeButton = document.getElementById("probe");
const beginButton = document.getElementById("begin");
const stopButton = document.getElementById("stop");
const buildPromptButton = document.getElementById("buildPrompt");
const copyPromptButton = document.getElementById("copyPrompt");
const openWorkbenchButton = document.getElementById("openWorkbench");
const exportSessionButton = document.getElementById("exportSession");

function say(text) {
  promptBox.value = String(text || "");
}

function setNote(text) {
  note.textContent = String(text || "Ready");
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message
        });
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
  if (!chrome.scripting || !chrome.scripting.executeScript) {
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["src/content_script.js"]
    });
  } catch (_) {
    // Some pages do not allow injection. Caller will show a human message.
  }
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message
        });
        return;
      }

      resolve(response || { ok: false, error: "No response returned." });
    });
  });
}

function renderState(state) {
  const surface = state && state.surface ? state.surface : {};
  const active = Boolean(state && state.active_capture);

  captureBadge.textContent = active ? "Capturing" : "Inactive";
  captureBadge.className = active ? "badge green" : "badge red";

  const provider = surface.provider || "unknown";
  surfaceBadge.textContent = "AI surface: " + provider;

  const domain = surface.domain || "-";
  const messages = surface.message_count || 0;
  const input = surface.input_detected ? "yes" : "no";
  const events = state && Array.isArray(state.events) ? state.events.length : 0;

  metaLine.textContent =
    "domain=" + domain +
    " | messages=" + messages +
    " | input=" + input +
    " | events=" + events;

  beginButton.disabled = active;
  stopButton.disabled = !active;
}

function humanSummary(state, timeline) {
  const surface = state && state.surface ? state.surface : {};
  const lifecycle = state && state.lifecycle ? state.lifecycle : {};
  const events = state && Array.isArray(state.events) ? state.events.length : 0;
  const captures = Array.isArray(timeline) ? timeline : [];

  return [
    "HAAI session summary",
    "",
    "Capture: " + (state && state.active_capture ? "running" : "stopped"),
    "Provider: " + (surface.provider || "unknown"),
    "Domain: " + (surface.domain || "-"),
    "Title: " + (surface.title || "-"),
    "Visible messages: " + (surface.message_count || 0),
    "Input detected: " + (surface.input_detected ? "yes" : "no"),
    "Recorded events: " + events,
    "Domain changes: " + (lifecycle.domain_changes || 0),
    "Conversation changes: " + (lifecycle.conversation_changes || 0),
    "Exports: " + (lifecycle.exports || 0),
    "Session started: " + (state.session_started_utc || "-"),
    "Session stopped: " + (state.session_stopped_utc || "-"),
    "Last activity: " + (state.last_activity_utc || "-"),
    "",
    "This week captures: " + captures.length,
    "All time captures: " + captures.length,
    "",
    "Use Export Session when the conversation is ready to save.",
    "Use Open Workbench for replay, verification, packet export, and certification."
  ].join("\n");
}

async function refreshState(showSummary) {
  const response = await sendRuntimeMessage({ type: "haai_get_state" });

  if (!response || response.ok === false) {
    say("State refresh failed.\n\n" + (response && response.error ? response.error : "No state returned."));
    setNote("State check failed");
    return;
  }

  const state = response.state || response;
  const timeline = response.timeline || [];

  renderState(state);

  if (showSummary) {
    say(humanSummary(state, timeline));
  }

  setNote("Ready");
}

checkButton.addEventListener("click", async () => {
  setNote("Checking...");
  await refreshState(true);
});

probeButton.addEventListener("click", async () => {
  setNote("Probing page...");

  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);

    const response = await sendTabMessage(tab.id, { type: "haai_probe_page" });

    if (!response || response.ok === false) {
      await refreshState(true);
      setNote("Probe used state fallback");
      return;
    }

    say("Page probe complete.\n\nProvider: " + (response.provider || "unknown") + "\nDomain: " + (response.domain || "-") + "\nMessages: " + (response.message_count || 0));
    await refreshState(false);
    setNote("Probe complete");
  } catch (err) {
    say("Probe failed.\n\n" + String(err && err.message ? err.message : err));
    setNote("Probe failed");
  }
});

beginButton.addEventListener("click", async () => {
  setNote("Starting capture...");

  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);

    const response = await sendRuntimeMessage({ type: "haai_start_capture" });

    if (!response || response.ok === false) {
      say("Capture start failed.\n\n" + (response && response.error ? response.error : "No response returned."));
      setNote("Capture start failed");
      return;
    }

    await refreshState(true);
    setNote("Capture started");
  } catch (err) {
    say("Capture start failed.\n\n" + String(err && err.message ? err.message : err));
    setNote("Capture start failed");
  }
});

stopButton.addEventListener("click", async () => {
  setNote("Stopping capture...");

  const response = await sendRuntimeMessage({ type: "haai_stop_capture" });

  if (!response || response.ok === false) {
    say("Capture stop failed.\n\n" + (response && response.error ? response.error : "No response returned."));
    setNote("Capture stop failed");
    return;
  }

  await refreshState(true);
  setNote("Capture stopped");
});

buildPromptButton.addEventListener("click", async () => {
  setNote("Building context prompt...");

  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);

    const response = await sendTabMessage(tab.id, { type: "haai_build_context_prompt" });

    if (!response || response.ok === false) {
      say("Context prompt failed.\n\n" + (response && response.error ? response.error : "No response returned."));
      setNote("Prompt failed");
      return;
    }

    say(response.prompt || "No prompt returned.");
    setNote("Prompt ready");
  } catch (err) {
    say("Context prompt failed.\n\n" + String(err && err.message ? err.message : err));
    setNote("Prompt failed");
  }
});

copyPromptButton.addEventListener("click", async () => {
  try {
    const value = promptBox.value || "";

    if (!value.trim()) {
      setNote("Nothing to copy");
      return;
    }

    await navigator.clipboard.writeText(value);
    setNote("Copied");
  } catch (err) {
    say("Copy failed.\n\n" + String(err && err.message ? err.message : err));
    setNote("Copy failed");
  }
});

openWorkbenchButton.addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("src/workbench.html")
  });
});

exportSessionButton.addEventListener("click", async () => {
  setNote("Exporting session...");

  const response = await sendRuntimeMessage({ type: "haai_export_session" });

  if (!response || response.ok === false) {
    say("Export failed.\n\n" + (response && response.error ? response.error : "No response returned."));
    setNote("Export failed");
    return;
  }

  say(
    "Session export ready.\n\n" +
    "File: " + (response.filename || "-") + "\n" +
    "SHA-256: " + (response.sha256 || "-")
  );

  await refreshState(false);
  setNote("Export ready");
});

refreshState(false);
