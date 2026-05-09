const promptBox = document.getElementById("promptBox");
const checkButton = document.getElementById("checkButton");
const probeButton = document.getElementById("probeButton");
const beginButton = document.getElementById("beginButton");
const stopButton = document.getElementById("stopButton");
const buildPromptButton = document.getElementById("buildPromptButton");
const copyPromptButton = document.getElementById("copyPromptButton");
const statePill = document.getElementById("statePill");
const surfacePill = document.getElementById("surfacePill");
const stateDetails = document.getElementById("stateDetails");

let currentState = null;

function setText(value) {
  promptBox.value = String(value || "");
}

function setButtons(state) {
  const active = !!(state && state.active);
  beginButton.disabled = active;
  stopButton.disabled = !active;
  probeButton.disabled = !active;
}

function renderState(state) {
  currentState = state || null;
  const active = !!(state && state.active);

  statePill.textContent = active ? "Active" : "Inactive";
  statePill.className = "pill " + (active ? "active" : "inactive");

  const surface = state && state.detectedAiSurface ? state.detectedAiSurface.label : "No AI surface detected";
  surfacePill.textContent = surface;

  const details = [
    "session=" + (state && state.sessionId ? state.sessionId : "-"),
    "events=" + (state && typeof state.eventCount === "number" ? state.eventCount : 0),
    "last=" + (state && state.lastEventType ? state.lastEventType : "-")
  ].join(" · ");

  stateDetails.textContent = details;
  setButtons(state);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs[0] || !tabs[0].id) {
    throw new Error("NO_ACTIVE_TAB");
  }
  return tabs[0];
}

async function ensureContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "haai_ping_content" });
    if (response && response.ok) {
      return response;
    }
  } catch (_err) {
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/content_script.js"]
  });

  return await chrome.tabs.sendMessage(tabId, { type: "haai_ping_content" });
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

async function refreshState(showOutput) {
  const response = await sendMessage({ type: "haai_get_state" });

  if (response && response.ok) {
    renderState(response.state);
  }

  if (showOutput) {
    setText(JSON.stringify(response, null, 2));
  }

  return response;
}

checkButton.addEventListener("click", async () => {
  await refreshState(true);
});

probeButton.addEventListener("click", async () => {
  try {
    const tab = await getActiveTab();
    const ping = await ensureContentScript(tab.id);

    const response = await chrome.tabs.sendMessage(tab.id, { type: "haai_capture_probe" });
    await refreshState(false);

    setText(JSON.stringify({ ping, response }, null, 2));
  } catch (err) {
    setText("HAAI_PROBE_ERROR: " + String(err && err.message ? err.message : err));
  }
});

beginButton.addEventListener("click", async () => {
  const response = await sendMessage({ type: "haai_begin_capture" });

  if (response && response.ok) {
    renderState(response.state);
  }

  setText(JSON.stringify(response, null, 2));
});

stopButton.addEventListener("click", async () => {
  const response = await sendMessage({ type: "haai_stop_capture" });

  if (response && response.ok) {
    renderState(response.state);
  }

  setText(JSON.stringify(response, null, 2));
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
      refreshState(false);
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

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === "haai_state_changed" && message.state) {
    renderState(message.state);
  }
});

refreshState(false);
