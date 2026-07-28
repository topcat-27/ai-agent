(() => {
  "use strict";

  const DEFAULT_CONFIG = {
    name: "Project Partner",
    subtitle: "A calm co-pilot for turning ideas into next steps.",
    welcomeMessage:
      "Hello! I’m your project partner. Tell me what you’re working on, and we’ll turn it into clear, manageable next steps.",
    primaryColour: "#6D4AFF",
    examplePrompts: [
      "Help me decide the three most important things to do today",
      "Turn my project idea into a one-week action plan",
      "What questions should I answer before I start this project?",
    ],
  };
  const STORAGE_KEY = "ai-solopreneur-chat-session";

  const elements = {
    agentInitials: document.querySelector("#agent-initials"),
    agentName: document.querySelector("#agent-name"),
    agentSubtitle: document.querySelector("#agent-subtitle"),
    characterCount: document.querySelector("#character-count"),
    conversation: document.querySelector("#conversation"),
    conversationAgentName: document.querySelector("#conversation-agent-name"),
    form: document.querySelector("#chat-form"),
    input: document.querySelector("#message-input"),
    mobileAgentInitials: document.querySelector("#mobile-agent-initials"),
    requestStatus: document.querySelector("#request-status"),
    resetButton: document.querySelector("#reset-button"),
    sendButton: document.querySelector("#send-button"),
    sendButtonLabel: document.querySelector("#send-button-label"),
    suggestionList: document.querySelector("#suggestion-list"),
    suggestions: document.querySelector("#suggestions"),
  };

  let sessionId = loadOrCreateSession();
  let requestInProgress = false;
  let loadingMessage = null;

  function cleanText(value, fallback, maximumLength) {
    if (typeof value !== "string") {
      return fallback;
    }
    const cleaned = value.trim();
    return cleaned.length > 0 ? cleaned.slice(0, maximumLength) : fallback;
  }

  function loadConfig() {
    const supplied =
      typeof window.AGENT_CONFIG === "object" && window.AGENT_CONFIG !== null
        ? window.AGENT_CONFIG
        : {};
    const prompts = Array.isArray(supplied.examplePrompts)
      ? supplied.examplePrompts
          .filter((prompt) => typeof prompt === "string" && prompt.trim())
          .slice(0, 6)
          .map((prompt) => prompt.trim().slice(0, 180))
      : DEFAULT_CONFIG.examplePrompts;
    const suppliedColour = cleanText(
      supplied.primaryColour,
      DEFAULT_CONFIG.primaryColour,
      40,
    );

    return {
      name: cleanText(supplied.name, DEFAULT_CONFIG.name, 60),
      subtitle: cleanText(supplied.subtitle, DEFAULT_CONFIG.subtitle, 160),
      welcomeMessage: cleanText(
        supplied.welcomeMessage,
        DEFAULT_CONFIG.welcomeMessage,
        800,
      ),
      primaryColour:
        window.CSS?.supports("color", suppliedColour)
          ? suppliedColour
          : DEFAULT_CONFIG.primaryColour,
      examplePrompts:
        prompts.length > 0 ? prompts : DEFAULT_CONFIG.examplePrompts,
    };
  }

  const config = loadConfig();

  function getInitials(name) {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase();
  }

  function createSessionId() {
    return window.crypto.randomUUID();
  }

  function storeSession(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // The chat still works when private browsing blocks local storage.
    }
  }

  function loadOrCreateSession() {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (
        stored &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          stored,
        )
      ) {
        return stored;
      }
    } catch {
      // Fall through to a fresh session.
    }

    const freshSession = createSessionId();
    storeSession(freshSession);
    return freshSession;
  }

  function applyConfig() {
    document.title = `${config.name} · Local agent`;
    document.documentElement.style.setProperty(
      "--brand-primary",
      config.primaryColour,
    );
    elements.agentName.textContent = config.name;
    elements.agentSubtitle.textContent = config.subtitle;
    elements.conversationAgentName.textContent = config.name;

    const initials = getInitials(config.name);
    elements.agentInitials.textContent = initials;
    elements.mobileAgentInitials.textContent = initials;
    elements.input.setAttribute("aria-label", `Message ${config.name}`);
  }

  function scrollConversation() {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    elements.conversation.scrollTo({
      top: elements.conversation.scrollHeight,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }

  function createAvatar(kind) {
    const avatar = document.createElement("span");
    avatar.className = `message__avatar message__avatar--${kind}`;
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = kind === "agent" ? getInitials(config.name) : "You";
    return avatar;
  }

  function addMessage(kind, text) {
    const wrapper = document.createElement("article");
    wrapper.className = `message message--${kind}`;

    const body = document.createElement("div");
    body.className = "message__body";

    const label = document.createElement("p");
    label.className = "message__label";
    label.textContent = kind === "agent" ? config.name : "You";

    const copy = document.createElement("p");
    copy.className = "message__copy";
    copy.textContent = text;

    body.append(label, copy);
    wrapper.append(createAvatar(kind), body);
    elements.conversation.append(wrapper);
    scrollConversation();
    return wrapper;
  }

  function addLoadingMessage() {
    const wrapper = document.createElement("article");
    wrapper.className = "message message--agent";

    const body = document.createElement("div");
    body.className = "message__body";

    const label = document.createElement("p");
    label.className = "message__label";
    label.textContent = config.name;

    const dots = document.createElement("span");
    dots.className = "thinking-dots";
    dots.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 3; index += 1) {
      dots.append(document.createElement("span"));
    }

    const accessibleText = document.createElement("span");
    accessibleText.className = "visually-hidden";
    accessibleText.textContent = `${config.name} is thinking`;

    body.append(label, dots, accessibleText);
    wrapper.append(createAvatar("agent"), body);
    elements.conversation.append(wrapper);
    scrollConversation();
    return wrapper;
  }

  function addError(message, retryMessage) {
    const alert = document.createElement("div");
    alert.className = "chat-error";
    alert.setAttribute("role", "alert");

    const icon = document.createElement("span");
    icon.className = "chat-error__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "!";

    const content = document.createElement("div");
    const title = document.createElement("p");
    title.className = "chat-error__title";
    title.textContent = "That didn’t work";
    const detail = document.createElement("p");
    detail.className = "chat-error__detail";
    detail.textContent = message;
    content.append(title, detail);

    if (retryMessage) {
      const retry = document.createElement("button");
      retry.className = "retry-button";
      retry.type = "button";
      retry.textContent = "Try again";
      retry.addEventListener("click", () => {
        alert.remove();
        void sendMessage(retryMessage, false);
      });
      content.append(retry);
    }

    alert.append(icon, content);
    elements.conversation.append(alert);
    scrollConversation();
  }

  function renderSuggestions() {
    elements.suggestionList.replaceChildren();
    for (const prompt of config.examplePrompts) {
      const button = document.createElement("button");
      button.className = "suggestion-button";
      button.type = "button";
      button.textContent = prompt;
      button.addEventListener("click", () => {
        void sendMessage(prompt, true);
      });
      elements.suggestionList.append(button);
    }
  }

  function renderNewConversation() {
    elements.conversation.replaceChildren();
    addMessage("agent", config.welcomeMessage);
    elements.suggestions.hidden = false;
    elements.input.value = "";
    updateCharacterCount();
    resizeInput();
  }

  function setBusy(isBusy) {
    requestInProgress = isBusy;
    elements.conversation.setAttribute("aria-busy", String(isBusy));
    elements.input.disabled = isBusy;
    elements.sendButton.disabled = isBusy;
    elements.resetButton.disabled = isBusy;
    for (const suggestion of elements.suggestionList.querySelectorAll("button")) {
      suggestion.disabled = isBusy;
    }
    elements.sendButtonLabel.textContent = isBusy ? "Working" : "Send";
    elements.requestStatus.textContent = isBusy
      ? `${config.name} is working on your request…`
      : "Press Enter to send · Shift + Enter for a new line";
  }

  function friendlyError(errorBody) {
    if (
      typeof errorBody === "object" &&
      errorBody !== null &&
      typeof errorBody.error === "object" &&
      errorBody.error !== null &&
      typeof errorBody.error.message === "string"
    ) {
      return errorBody.error.message;
    }
    return "The local agent could not reply. Check that n8n is running, then try again.";
  }

  async function sendMessage(rawMessage, showUserMessage) {
    if (requestInProgress) {
      return;
    }

    const message = rawMessage.trim();
    if (!message) {
      elements.input.focus();
      return;
    }

    if (showUserMessage) {
      addMessage("user", message);
    }
    elements.suggestions.hidden = true;
    elements.input.value = "";
    updateCharacterCount();
    resizeInput();
    setBusy(true);
    loadingMessage = addLoadingMessage();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message }),
      });

      let responseBody = null;
      try {
        responseBody = await response.json();
      } catch {
        // A stable fallback is shown below.
      }

      if (!response.ok) {
        throw new Error(friendlyError(responseBody));
      }
      if (
        typeof responseBody !== "object" ||
        responseBody === null ||
        responseBody.sessionId !== sessionId ||
        typeof responseBody.reply !== "string" ||
        !responseBody.reply.trim()
      ) {
        throw new Error(
          "The agent returned an unexpected response. Check the workflow and try again.",
        );
      }

      loadingMessage.remove();
      loadingMessage = null;
      addMessage("agent", responseBody.reply.trim());
    } catch (error) {
      loadingMessage?.remove();
      loadingMessage = null;
      const messageText =
        error instanceof Error
          ? error.message
          : "The local agent could not reply. Check n8n and try again.";
      addError(messageText, message);
    } finally {
      setBusy(false);
      elements.input.focus();
    }
  }

  function updateCharacterCount() {
    const length = elements.input.value.length;
    elements.characterCount.textContent = `${length} / 4000`;
    elements.characterCount.classList.toggle(
      "character-count--near-limit",
      length >= 3_600,
    );
  }

  function resizeInput() {
    elements.input.style.height = "auto";
    elements.input.style.height = `${Math.min(elements.input.scrollHeight, 160)}px`;
  }

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendMessage(elements.input.value, true);
  });

  elements.input.addEventListener("input", () => {
    updateCharacterCount();
    resizeInput();
  });

  elements.input.addEventListener("keydown", (event) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.isComposing
    ) {
      event.preventDefault();
      elements.form.requestSubmit();
    }
  });

  elements.resetButton.addEventListener("click", () => {
    sessionId = createSessionId();
    storeSession(sessionId);
    renderNewConversation();
    elements.requestStatus.textContent = "New conversation started";
    elements.input.focus();
  });

  applyConfig();
  renderSuggestions();
  renderNewConversation();
})();
