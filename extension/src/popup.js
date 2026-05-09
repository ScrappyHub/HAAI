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

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0 || !tabs[0].id) {
    throw new Error("HAAI_NO_ACTIVE_TAB");
  }
  return tabs[0];
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/content_script.js"]
  });
}

pingButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "haai_ping" }, (response) => {
    setText(JSON.stringify(response, null, 2));
  });
});

beginButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "haai_begin_capture" }, (response) => {
    setText(JSON.stringify(response, null, 2));
  });
});

stopButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "haai_stop_capture" }, (response) => {
    setText(JSON.stringify(response, null, 2));
  });
});

buildPromptButton.addEventListener("click", async () => {
  try {
    const tab = await getActiveTab();

    await ensureContentScript(tab.id);

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
