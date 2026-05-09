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
const humanStatus = document.getElementById("humanStatus");

function say(text) {
  output.value = text;
}

function note(text) {
  notice.textContent = text;
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

  humanStatus.textContent =
    "domain=" + (surface.domain || "-") +
    " · messages=" + (surface.message_count || 0) +
    " · input=" + (surface.input_detected ? "yes" : "no") +
    " · events=" + events;
}

function getState(show) {
  chrome.runtime.sendMessage({ type: "haai_get_state" }, (response) => {
    if (!response || !response.ok) {
      note("Could not read HAAI state.");
      return;
    }

    render(response.state);

    if (show) {
      const s = response.state.surface || {};
      say(
        "HAAI is " + (response.state.active_capture ? "capturing." : "not capturing.") + "\n\n" +
        "Detected page: " + (s.detected ? "yes" : "no") + "\n" +
        "Provider: " + (s.provider || "unknown") + "\n" +
        "Domain: " + (s.domain || "-") + "\n" +
        "Visible messages: " + (s.message_count || 0) + "\n" +
        "Input box detected: " + (s.input_detected ? "yes" : "no") + "\n" +
        "Recorded events: " + response.state.events.length + "\n\n" +
        "Use Probe Page to embed HAAI into the current AI page."
      );
    }
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
    const response = await probePage();
    if (!response || !response.ok) {
      say("HAAI could not embed into this page.\n\nReason: " + (response ? response.reason : "unknown"));
      note("Probe failed.");
      return;
    }

    getState(false);
    say(
      "HAAI embedded into this page.\n\n" +
      "Provider: " + response.surface.provider + "\n" +
      "Domain: " + response.surface.domain + "\n" +
      "Visible messages: " + response.surface.message_count + "\n" +
      "Input box detected: " + (response.surface.input_detected ? "yes" : "no")
    );
    note("Page probe complete.");
  } catch (err) {
    say("Probe failed: " + String(err && err.message ? err.message : err));
  }
});

beginButton.addEventListener("click", async () => {
  await probePage();

  chrome.runtime.sendMessage({ type: "haai_begin_capture" }, (response) => {
    render(response.state);
    say("Capture started. HAAI will now watch this AI page for conversation changes.");
    note("Capture running.");
  });
});

stopButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "haai_stop_capture" }, (response) => {
    render(response.state);
    say("Capture stopped. Recorded events remain in memory until extension reload.");
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
        return;
      }

      say(response.prompt);
      note("Context recovery prompt built.");
    });
  } catch (err) {
    say("Prompt build failed: " + String(err && err.message ? err.message : err));
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
  note("Prompt copied to clipboard.");

  setTimeout(() => {
    copyButton.textContent = "Copy Prompt";
    copyButton.disabled = false;
  }, 1500);
});

getState(false);
