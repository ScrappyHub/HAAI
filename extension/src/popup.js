"use strict";

const promptBox = document.getElementById("promptBox");
const pingButton = document.getElementById("ping");
const beginButton = document.getElementById("begin");
const stopButton = document.getElementById("stop");
const buildPromptButton = document.getElementById("buildPrompt");
const copyPromptButton = document.getElementById("copyPrompt");
const capturePill = document.getElementById("capturePill");
const eventPill = document.getElementById("eventPill");
const notice = document.getElementById("notice");

function setNotice(value) {
  notice.textContent = value;
}

function setText(value) {
  promptBox.value = value;
}

function renderState(state) {
  const active = Boolean(state && state.active_capture);
  const count = state && Array.isArray(state.events) ? state.events.length : 0;

  beginButton.disabled = active;
  stopButton.disabled = !active;

  capturePill.textContent = active ? "Capturing" : "Idle";
  capturePill.className = active ? "pill on" : "pill";

  eventPill.textContent = String(count) + " events";
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tabs || tabs.length === 0 || !tabs[0].id) {
    throw new Error("HAAI_NO_ACTIVE_TAB");
  }

  return tabs[0];
}

async function injectContent(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ["src/content_script.js"]
  });
}

function refreshState(showText) {
  chrome.runtime.sendMessage({ type: "haai_ping" }, (response) => {
    if (response && response.ok) {
      renderState(response.state);

      if (showText) {
        const count = response.state && Array.isArray(response.state.events) ? response.state.events.length : 0;
        setText("HAAI STATUS\nmode=" + response.state.recorder_mode + "\nactive=" + response.state.active_capture + "\nevents=" + count);
      }

      setNotice("Status refreshed.");
      return;
    }

    if (showText) {
      setText(JSON.stringify(response, null, 2));
    }
  });
}

pingButton.addEventListener("click", () => {
  refreshState(true);
});

beginButton.addEventListener("click", async () => {
  try {
    const tab = await activeTab();
    await injectContent(tab.id);

    chrome.runtime.sendMessage({ type: "haai_begin_capture" }, (response) => {
      if (response && response.ok) {
        renderState(response.state);
        setNotice(response.result === "already_capturing" ? "Capture already running." : "Capture started.");
      }

      setText(JSON.stringify(response, null, 2));
    });
  } catch (err) {
    setNotice("Begin failed.");
    setText("HAAI_BEGIN_CAPTURE_ERROR: " + String(err && err.message ? err.message : err));
  }
});

stopButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "haai_stop_capture" }, (response) => {
    if (response && response.ok) {
      renderState(response.state);
      setNotice("Capture stopped.");
    }

    setText(JSON.stringify(response, null, 2));
  });
});

buildPromptButton.addEventListener("click", async () => {
  try {
    const tab = await activeTab();
    await injectContent(tab.id);

    chrome.tabs.sendMessage(tab.id, { type: "haai_build_context_prompt" }, (response) => {
      if (chrome.runtime.lastError) {
        setNotice("Content script unavailable.");
        setText("HAAI_CONTENT_SCRIPT_ERROR: " + chrome.runtime.lastError.message);
        return;
      }

      if (!response || !response.ok) {
        setNotice("Prompt build failed.");
        setText("HAAI_CONTEXT_PROMPT_FAILED");
        return;
      }

      setText(response.prompt);
      setNotice("Recovery prompt built. Ready to copy.");
    });
  } catch (err) {
    setNotice("Prompt build failed.");
    setText("HAAI_BUILD_PROMPT_ERROR: " + String(err && err.message ? err.message : err));
  }
});

copyPromptButton.addEventListener("click", async () => {
  try {
    const value = promptBox.value || "";

    if (!value.trim()) {
      setNotice("Nothing to copy.");
      return;
    }

    await navigator.clipboard.writeText(value);

    copyPromptButton.textContent = "Copied prompt";
    copyPromptButton.className = "copied";
    copyPromptButton.disabled = true;
    setNotice("Copied prompt to clipboard.");

    setTimeout(() => {
      copyPromptButton.textContent = "Copy prompt";
      copyPromptButton.className = "secondary";
      copyPromptButton.disabled = false;
    }, 1600);
  } catch (err) {
    setNotice("Copy failed.");
  }
});

refreshState(false);
