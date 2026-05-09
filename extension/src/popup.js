"use strict";

const promptBox = document.getElementById("promptBox");
const pingButton = document.getElementById("ping");
const beginButton = document.getElementById("begin");
const stopButton = document.getElementById("stop");
const buildPromptButton = document.getElementById("buildPrompt");
const copyPromptButton = document.getElementById("copyPrompt");

function setText(value) {
  promptBox.value = value;
}

function renderState(state) {
  const active = Boolean(state && state.active_capture);

  beginButton.disabled = active;
  stopButton.disabled = !active;

  beginButton.textContent = active ? "Capture running" : "Begin capture";
  stopButton.textContent = active ? "Stop capture" : "Capture stopped";
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

function refreshState() {
  chrome.runtime.sendMessage({ type: "haai_ping" }, (response) => {
    if (response && response.ok) {
      renderState(response.state);
    }
  });
}

pingButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "haai_ping" }, (response) => {
    if (response && response.ok) {
      renderState(response.state);
    }

    setText(JSON.stringify(response, null, 2));
  });
});

beginButton.addEventListener("click", async () => {
  try {
    const tab = await activeTab();
    await injectContent(tab.id);

    chrome.runtime.sendMessage({ type: "haai_begin_capture" }, (response) => {
      if (response && response.ok) {
        renderState(response.state);
      }

      setText(JSON.stringify(response, null, 2));
    });
  } catch (err) {
    setText("HAAI_BEGIN_CAPTURE_ERROR: " + String(err && err.message ? err.message : err));
  }
});

stopButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "haai_stop_capture" }, (response) => {
    if (response && response.ok) {
      renderState(response.state);
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
        setText("HAAI_CONTENT_SCRIPT_ERROR: " + chrome.runtime.lastError.message);
        return;
      }

      if (!response || !response.ok) {
        setText("HAAI_CONTEXT_PROMPT_FAILED");
        return;
      }

      setText(response.prompt);
    });
  } catch (err) {
    setText("HAAI_BUILD_PROMPT_ERROR: " + String(err && err.message ? err.message : err));
  }
});

copyPromptButton.addEventListener("click", async () => {
  try {
    const value = promptBox.value || "";

    if (!value.trim()) {
      setText("HAAI_COPY_SKIPPED_EMPTY_PROMPT");
      return;
    }

    await navigator.clipboard.writeText(value);
    setText(value + "\n\nHAAI_COPY_OK");
  } catch (err) {
    setText("HAAI_COPY_FAIL: " + String(err && err.message ? err.message : err));
  }
});

refreshState();
