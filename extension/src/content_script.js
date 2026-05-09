"use strict";

if (!window.__HAAI_CONTENT_LOADED__) {
  window.__HAAI_CONTENT_LOADED__ = true;

  let lastSnapshot = "";

  function cleanText(value) {
    if (typeof value !== "string") { return ""; }
    return value.replace(/\s+/g, " ").trim();
  }

  function detectProvider() {
    const d = location.hostname.toLowerCase();
    if (d.includes("chatgpt.com") || d.includes("openai.com")) { return "chatgpt"; }
    if (d.includes("claude.ai")) { return "claude"; }
    if (d.includes("gemini.google.com")) { return "gemini"; }
    if (d.includes("perplexity.ai")) { return "perplexity"; }
    if (d.includes("grok.com") || d.includes("x.ai")) { return "grok"; }
    return "unknown";
  }

  function detectInput() {
    return Boolean(
      document.querySelector("textarea") ||
      document.querySelector("[contenteditable='true']") ||
      document.querySelector("div[role='textbox']")
    );
  }

  function collectMessages() {
    const selectors = [
      "[data-message-author-role]",
      "article",
      "[data-testid]",
      ".markdown",
      "main"
    ];

    const seen = new Set();
    const messages = [];

    for (const selector of selectors) {
      const nodes = document.querySelectorAll(selector);

      for (const node of nodes) {
        const text = cleanText(node.innerText || node.textContent || "");
        if (!text || text.length < 8) { continue; }
        if (seen.has(text)) { continue; }

        seen.add(text);

        let role = "unknown";
        const attr = node.getAttribute && node.getAttribute("data-message-author-role");
        if (attr) { role = attr; }

        messages.push({
          role: role,
          text: text,
          length: text.length
        });

        if (messages.length >= 24) {
          return messages;
        }
      }
    }

    return messages;
  }

  function surfacePayload(messages) {
    const provider = detectProvider();
    const domain = location.hostname;

    return {
      detected: provider !== "unknown" || messages.length > 0 || detectInput(),
      provider: provider,
      domain: domain,
      url: location.href,
      title: document.title || "",
      message_count: messages.length,
      input_detected: detectInput()
    };
  }

  function emit(eventType, payload) {
    chrome.runtime.sendMessage({
      type: "haai_record_event",
      event: {
        schema: "haai.extension_event.v1",
        event_type: eventType,
        created_utc: new Date().toISOString(),
        source: "content_script",
        payload: payload
      }
    });
  }

  function probe() {
    const messages = collectMessages();
    const payload = surfacePayload(messages);
    emit("page_probe", payload);
    return payload;
  }

  function scan() {
    const messages = collectMessages();
    const fp = JSON.stringify(messages).slice(-12000);

    if (fp && fp !== lastSnapshot) {
      lastSnapshot = fp;
      const payload = surfacePayload(messages);
      payload.messages = messages;
      emit("conversation_snapshot", payload);
    }
  }

  function recoveryPrompt() {
    const messages = collectMessages();
    const payload = surfacePayload(messages);
    const evidence = messages.map((m) => "[" + m.role + "] " + m.text).join("\n\n---\n\n");

    return [
      "HAAI CONTEXT RECOVERY REQUEST",
      "",
      "The recorder started during an existing AI conversation.",
      "Reconstruct the current work context from the visible conversation evidence.",
      "",
      "Detected surface:",
      "- provider: " + payload.provider,
      "- domain: " + payload.domain,
      "- title: " + payload.title,
      "- messages visible: " + payload.message_count,
      "- input detected: " + payload.input_detected,
      "",
      "Return:",
      "1. What is being worked on.",
      "2. Recent user instructions.",
      "3. Recent assistant actions.",
      "4. Current blockers or errors.",
      "5. What should happen next.",
      "6. Confidence and uncertainty.",
      "",
      "Evidence:",
      evidence || "(No visible conversation text found.)"
    ].join("\n");
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      sendResponse({ ok: false, reason: "Invalid content message." });
      return true;
    }

    if (message.type === "haai_probe_page") {
      const payload = probe();
      scan();
      sendResponse({ ok: true, message: "Page probed.", surface: payload });
      return true;
    }

    if (message.type === "haai_build_context_prompt") {
      probe();
      scan();
      sendResponse({ ok: true, prompt: recoveryPrompt() });
      return true;
    }

    sendResponse({ ok: false, reason: "Unknown content message." });
    return true;
  });

  probe();
  scan();
  setInterval(scan, 2000);
}
