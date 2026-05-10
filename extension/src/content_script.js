"use strict";

if (!window.__HAAI_CONTENT_LOADED__) {
  window.__HAAI_CONTENT_LOADED__ = true;

  let lastSnapshot = "";
  let lastInputState = "";

  function canSend() {
    return typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id && chrome.runtime.sendMessage;
  }

  function safeSend(message) {
    try {
      if (!canSend()) { return; }
      chrome.runtime.sendMessage(message, () => {});
    } catch (err) {}
  }

  function cleanText(value) {
    if (typeof value !== "string") { return ""; }
    return value.replace(/\s+/g, " ").trim();
  }

  function provider() {
    const d = location.hostname.toLowerCase();
    if (d.includes("chatgpt.com") || d.includes("openai.com")) { return "chatgpt"; }
    if (d.includes("claude.ai")) { return "claude"; }
    if (d.includes("gemini.google.com")) { return "gemini"; }
    if (d.includes("perplexity.ai")) { return "perplexity"; }
    if (d.includes("grok.com") || d.includes("x.ai")) { return "grok"; }
    return "unknown";
  }

  function inputText() {
    const el = document.querySelector("textarea") || document.querySelector("[contenteditable='true']") || document.querySelector("div[role='textbox']");
    return el ? cleanText(el.value || el.innerText || el.textContent || "") : "";
  }

  function collectMessages() {
    const selectors = ["[data-message-author-role]", "article", ".markdown", "main"];
    const seen = new Set();
    const messages = [];

    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        const text = cleanText(node.innerText || node.textContent || "");
        if (!text || text.length < 8 || seen.has(text)) { continue; }
        seen.add(text);

        let role = "unknown";
        const attr = node.getAttribute && node.getAttribute("data-message-author-role");
        if (attr) { role = attr; }

        messages.push({ role, text, length: text.length });
        if (messages.length >= 32) { return messages; }
      }
    }

    return messages;
  }

  function surface(messages) {
    return {
      detected: provider() !== "unknown" || messages.length > 0 || inputText().length > 0,
      provider: provider(),
      domain: location.hostname,
      url: location.href,
      title: document.title || "",
      message_count: messages.length,
      input_detected: inputText().length > 0 || Boolean(document.querySelector("textarea,[contenteditable='true'],div[role='textbox']"))
    };
  }

  function emit(eventType, payload) {
    safeSend({
      type: "haai_record_event",
      event: {
        schema: "haai.extension_event.v1",
        event_type: eventType,
        created_utc: new Date().toISOString(),
        source: "content_script",
        payload
      }
    });
  }

  function scan() {
    const messages = collectMessages();
    const payload = surface(messages);
    const fp = JSON.stringify(messages).slice(-16000);

    if (fp && fp !== lastSnapshot) {
      lastSnapshot = fp;
      payload.messages = messages;
      emit("conversation_snapshot", payload);
    }

    const currentInput = inputText();
    if (currentInput !== lastInputState) {
      lastInputState = currentInput;
      emit("input_surface_changed", {
        ...payload,
        input_length: currentInput.length,
        input_preview: currentInput.slice(0, 500)
      });
    }
  }

  function promptText() {
    const messages = collectMessages();
    const payload = surface(messages);
    const evidence = messages.map((m) => "[" + m.role + "] " + m.text).join("\n\n---\n\n");

    return [
      "HAAI CONTEXT RECOVERY REQUEST",
      "",
      "Reconstruct this AI work session from captured browser evidence.",
      "",
      "Surface:",
      "- provider: " + payload.provider,
      "- domain: " + payload.domain,
      "- title: " + payload.title,
      "- visible messages: " + payload.message_count,
      "- input detected: " + payload.input_detected,
      "",
      "Return:",
      "1. What is being worked on.",
      "2. Recent user instructions.",
      "3. Recent assistant actions.",
      "4. Current blockers.",
      "5. Next step.",
      "6. Confidence and uncertainty.",
      "",
      "Evidence:",
      evidence || "(No visible conversation text found.)"
    ].join("\n");
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "haai_probe_page") {
      scan();
      sendResponse({ ok: true, surface: surface(collectMessages()) });
      return true;
    }

    if (message.type === "haai_build_context_prompt") {
      scan();
      sendResponse({ ok: true, prompt: promptText() });
      return true;
    }

    sendResponse({ ok: false, reason: "Unknown content message." });
    return true;
  });

  emit("page_probe", surface(collectMessages()));
  scan();
  setInterval(scan, 2000);
}
