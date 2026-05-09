"use strict";

function haaiNormalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim();
}

function haaiCollectRecentMessages() {
  const selectors = [
    "[data-message-author-role]",
    ".markdown",
    ".message",
    "article"
  ];

  const collected = [];

  for (const selector of selectors) {
    const nodes = document.querySelectorAll(selector);

    for (const node of nodes) {
      const text = haaiNormalizeText(node.innerText || node.textContent || "");

      if (!text) {
        continue;
      }

      collected.push(text);

      if (collected.length >= 12) {
        return collected.slice(-12);
      }
    }
  }

  return collected.slice(-12);
}

function haaiBuildRecoveryPrompt(messages) {
  const joined = messages.join("\n\n");

  return [
    "You are reconstructing context from an already-running AI conversation.",
    "",
    "Tasks:",
    "- explain what the user and assistant are working on",
    "- summarize the recent technical direction",
    "- identify likely goals",
    "- identify unresolved blockers",
    "- produce a clean continuation prompt",
    "",
    "Recent conversation evidence:",
    joined,
    "",
    "Return:",
    "1. short summary",
    "2. technical breakdown",
    "3. current blockers",
    "4. recommended next step",
    "5. continuation prompt"
  ].join("\n");
}

async function haaiCopyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);

    console.log("HAAI_CLIPBOARD_OK");
  } catch (err) {
    console.error("HAAI_CLIPBOARD_FAIL", err);
  }
}

function haaiInjectOverlay(promptText) {
  if (document.getElementById("haai-overlay-root")) {
    return;
  }

  const root = document.createElement("div");
  root.id = "haai-overlay-root";

  root.style.position = "fixed";
  root.style.top = "16px";
  root.style.right = "16px";
  root.style.width = "420px";
  root.style.height = "520px";
  root.style.background = "#111111";
  root.style.color = "#ffffff";
  root.style.zIndex = "999999";
  root.style.border = "1px solid #444";
  root.style.borderRadius = "10px";
  root.style.padding = "12px";
  root.style.fontFamily = "Consolas, monospace";
  root.style.boxShadow = "0 0 20px rgba(0,0,0,0.5)";

  const title = document.createElement("div");
  title.innerText = "HAAI Context Recovery";
  title.style.fontWeight = "bold";
  title.style.marginBottom = "10px";

  const textarea = document.createElement("textarea");
  textarea.value = promptText;
  textarea.style.width = "100%";
  textarea.style.height = "400px";
  textarea.style.background = "#1b1b1b";
  textarea.style.color = "#ffffff";
  textarea.style.border = "1px solid #333";
  textarea.style.resize = "none";

  const copyButton = document.createElement("button");
  copyButton.innerText = "Copy Prompt";
  copyButton.style.marginTop = "10px";

  copyButton.addEventListener("click", async () => {
    await haaiCopyToClipboard(textarea.value);
  });

  root.appendChild(title);
  root.appendChild(textarea);
  root.appendChild(copyButton);

  document.body.appendChild(root);
}

chrome.runtime.sendMessage(
  {
    type: "haai_ping"
  },
  (response) => {
    console.log("HAAI_BACKGROUND_RESPONSE", response);
  }
);

setTimeout(() => {
  const messages = haaiCollectRecentMessages();

  if (!messages || messages.length === 0) {
    console.log("HAAI_NO_MESSAGES_FOUND");
    return;
  }

  const prompt = haaiBuildRecoveryPrompt(messages);

  console.log("HAAI_CONTEXT_PROMPT_READY");

  haaiInjectOverlay(prompt);
}, 2500);
