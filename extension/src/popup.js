"use strict";

const checkButton = document.getElementById("check");
const probeButton = document.getElementById("probe");
const beginButton = document.getElementById("begin");
const stopButton = document.getElementById("stop");
const promptButton = document.getElementById("prompt");
const copyButton = document.getElementById("copy");
const output = document.getElementById("output");
const notice = document.getElementById("notice");
const capturePill = document.getElementById("capturePill");
const surfacePill = document.getElementById("surfacePill");
const sessionStatus = document.getElementById("humanStatus");

function say(text) {
  output.value = text;
}

function note(text) {
  notice.textContent = text;
}

function safeNumber(value) {
  if (typeof value === "number") {
    return value;
  }

  return 0;
}

function formatState(state) {
  const surface = state && state.surface ? state.surface : {};
  const lifecycle = state && state.lifecycle ? state.lifecycle : {};
  const events = state && Array.isArray(state.events) ? state.events.length : 0;

  return [
    "HAAI session summary",
    "",
    "Capture: " + (state && state.active_capture ? "running" : "stopped"),
    "Provider: " + (surface.provider || "unknown"),
    "Domain: " + (surface.domain || "-"),
    "Title: " + (surface.title || "-"),
    "Visible messages: " + safeNumber(surface.message_count),
    "Input detected: " + (surface.input_detected ? "yes" : "no"),
    "Recorded events: " + events,
    "Domain changes: " + safeNumber(lifecycle.domain_changes),
    "Conversation changes: " + safeNumber(lifecycle.conversation_changes),
    "Exports: " + safeNumber(lifecycle.exports),
    "Session started: " + (state && state.session_started_utc ? state.session_started_utc : "-"),
    "Session stopped: " + (state && state.session_stopped_utc ? state.session_stopped_utc : "-"),
    "Last activity: " + (state && state.last_activity_utc ? state.last_activity_utc : "-"),
    "",
    "Use Probe Page if the current page changed.",
    "Use Export Session when the conversation is ready to save."
  ].join("\n");
}

function render(state) {
  const active = Boolean(state && state.active_capture);
  const surface = state && state.surface ? state.surface : {};
  const events = state && Array.isArray(state.events) ? state.events.length : 0;

  capturePill.textContent = active ? "Capturing" : "Inactive";
  capturePill.className = active ? "pill on" : "pill";

  surfacePill.textContent = surface.detected ? "AI surface: " + surface.provider : "No AI surface detected";
  surfacePill.className = surface.detected ? "pill ai" : "pill";

  beginButton.disabled = active;
  stopButton.disabled = !active;

  sessionStatus.textContent =
    "domain=" + (surface.domain || "-") +
    " | messages=" + safeNumber(surface.message_count) +
    " | input=" + (surface.input_detected ? "yes" : "no") +
    " | events=" + events;
}

function getState(showSummary) {
  note("Checking session state...");

  chrome.runtime.sendMessage({ type: "haai_get_state" }, (response) => {
    if (chrome.runtime.lastError) {
      say("HAAI check failed.\n\n" + chrome.runtime.lastError.message);
      note("Check failed.");
      return;
    }

    if (!response || !response.ok) {
      say("HAAI check failed. Background state was unavailable.");
      note("Check failed.");
      return;
    }

    render(response.state);

    if (showSummary) {
      say(formatState(response.state));
    }

    note("Session state refreshed.");
  });
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tabs || !tabs[0] || !tabs[0].id) {
    throw new Error("No active browser tab found.");
  }

  return tabs[0];
}

async function inject(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ["src/content_script.js"]
  });
}

async function probePage() {
  const tab = await activeTab();
  await inject(tab.id);

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { type: "haai_probe_page" }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, reason: chrome.runtime.lastError.message });
        return;
      }

      resolve(response);
    });
  });
}

checkButton.addEventListener("click", () => {
  getState(true);
});

probeButton.addEventListener("click", async () => {
  try {
    note("Probing current page...");

    const response = await probePage();

    if (!response || !response.ok) {
      say("HAAI could not attach to this page.\n\nReason: " + (response ? response.reason : "unknown"));
      note("Probe failed.");
      return;
    }

    getState(false);

    say(
      "HAAI attached to this page.\n\n" +
      "Provider: " + response.surface.provider + "\n" +
      "Domain: " + response.surface.domain + "\n" +
      "Visible messages: " + response.surface.message_count + "\n" +
      "Input box detected: " + (response.surface.input_detected ? "yes" : "no")
    );

    note("Page probe complete.");
  } catch (err) {
    say("Probe failed: " + String(err && err.message ? err.message : err));
    note("Probe failed.");
  }
});

beginButton.addEventListener("click", async () => {
  try {
    await probePage();

    chrome.runtime.sendMessage({ type: "haai_begin_capture" }, (response) => {
      if (chrome.runtime.lastError) {
        say("Capture start failed.\n\n" + chrome.runtime.lastError.message);
        note("Capture start failed.");
        return;
      }

      render(response.state);
      say("Capture started. HAAI is watching this AI page for message, conversation, and domain changes.");
      note("Capture running.");
    });
  } catch (err) {
    say("Capture start failed: " + String(err && err.message ? err.message : err));
    note("Capture start failed.");
  }
});

stopButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "haai_stop_capture" }, (response) => {
    if (chrome.runtime.lastError) {
      say("Capture stop failed.\n\n" + chrome.runtime.lastError.message);
      note("Capture stop failed.");
      return;
    }

    render(response.state);
    say(formatState(response.state) + "\n\nCapture stopped. Session evidence is saved and ready to export.");
    note("Capture stopped.");
  });
});

promptButton.addEventListener("click", async () => {
  try {
    const tab = await activeTab();
    await inject(tab.id);

    chrome.tabs.sendMessage(tab.id, { type: "haai_build_context_prompt" }, (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        say("Could not build context prompt. Probe the page first, then try again.");
        note("Prompt failed.");
        return;
      }

      say(response.prompt);
      note("Context recovery prompt built.");
    });
  } catch (err) {
    say("Prompt build failed: " + String(err && err.message ? err.message : err));
    note("Prompt failed.");
  }
});

copyButton.addEventListener("click", async () => {
  const value = output.value || "";

  if (!value.trim()) {
    note("Nothing to copy.");
    return;
  }

  await navigator.clipboard.writeText(value);
  copyButton.textContent = "Copied Prompt";
  copyButton.disabled = true;
  note("Copied to clipboard.");

  setTimeout(() => {
    copyButton.textContent = "Copy Prompt";
    copyButton.disabled = false;
  }, 1500);
});

const exportButton = document.createElement("button");
exportButton.textContent = "Export Session";
exportButton.style.marginTop = "8px";
exportButton.style.width = "100%";
document.querySelector(".grid").insertAdjacentElement("afterend", exportButton);

exportButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "haai_export_session" }, (response) => {
    if (chrome.runtime.lastError) {
      say("Export failed.\n\n" + chrome.runtime.lastError.message);
      note("Export failed.");
      return;
    }

    if (!response || !response.ok) {
      say("Export failed. No session export was returned.");
      note("Export failed.");
      return;
    }

    const blob = new Blob([response.body], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    chrome.downloads.download({
      url: url,
      filename: response.filename,
      saveAs: true
    });

    if (response.state) {
      render(response.state);
    }

    say("Export ready.\n\nFile: " + response.filename + "\nSHA-256: " + response.sha256);
    note("Session export ready.");
  });
});

getState(false);
