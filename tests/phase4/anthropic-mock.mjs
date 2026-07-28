import { createServer } from "node:http";

const PORT = 3_401;
const MODEL = "claude-sonnet-4-6";
let messageCalls = 0;
let toolUseResponses = 0;
let lastRequest = null;

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function contentText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function latestToolResult(messages) {
  for (const message of [...messages].reverse()) {
    if (!Array.isArray(message.content)) {
      continue;
    }
    const result = message.content.find((part) => part?.type === "tool_result");
    if (result) {
      return typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.content);
    }
  }
  return null;
}

function taskReplyFromToolResult(rawResult) {
  try {
    const parsed = JSON.parse(rawResult);
    const value = Array.isArray(parsed) ? parsed[0] : parsed;
    const tasks = Array.isArray(value?.tasks) ? value.tasks : [];
    if (tasks.length === 0) {
      return "There are no local tasks matching those filters.";
    }
    const lines = tasks.map(
      (task) => `#${task.id} ${task.title} (${task.status}, ${task.priority})`,
    );
    return `I found ${tasks.length} local tasks:\n${lines.join("\n")}`;
  } catch {
    return "I could not read the local task result.";
  }
}

function chooseResponse(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const textMessages = messages.map((message) => ({
    role: message.role,
    text: contentText(message.content),
  }));
  const userText = textMessages
    .filter((message) => message.role === "user" && message.text)
    .map((message) => message.text)
    .join("\n");
  const lastUser =
    [...textMessages].reverse().find(
      (message) => message.role === "user" && message.text,
    )?.text ?? "";
  const previousText = textMessages.slice(0, -1).map((message) => message.text).join("\n");
  const toolResult = latestToolResult(messages);
  const toolNames = Array.isArray(body.tools)
    ? body.tools.map((tool) => tool.name)
    : [];

  if (toolResult && /tasks?/i.test(userText)) {
    return { type: "text", text: taskReplyFromToolResult(toolResult) };
  }
  if (
    /(?:what|which|list|show).*(?:task|todo)|(?:task|todo).*(?:exist|open|blocked|priority)/i.test(
      lastUser,
    ) &&
    toolNames.includes("list_tasks")
  ) {
    return {
      type: "tool",
      tool: {
        type: "tool_use",
        id: `toolu_mock_${messageCalls}`,
        name: "list_tasks",
        input: { status: "all", priority: "all" },
      },
    };
  }
  if (/what is my launch called/i.test(lastUser)) {
    return {
      type: "text",
      text: /Lantern/i.test(previousText)
        ? "Your launch is called Lantern."
        : "I do not know the launch name yet.",
    };
  }
  if (/called Lantern/i.test(lastUser)) {
    return {
      type: "text",
      text: "Got it — I will remember that your launch is called Lantern.",
    };
  }
  if (/long response/i.test(lastUser)) {
    return { type: "text", text: "x".repeat(12_000) };
  }
  return { type: "text", text: `Mock Claude reply: ${lastUser}` };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/metrics") {
    sendJson(response, 200, { messageCalls, toolUseResponses, lastRequest });
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/models") {
    sendJson(response, 200, {
      data: [
        {
          type: "model",
          id: MODEL,
          display_name: "Claude Sonnet 4.6",
          created_at: "2026-02-01T00:00:00Z",
        },
      ],
      has_more: false,
      first_id: MODEL,
      last_id: MODEL,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/messages") {
    try {
      const body = await readJson(request);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      messageCalls += 1;
      const selected = chooseResponse(body);
      if (selected.type === "tool") {
        toolUseResponses += 1;
      }
      lastRequest = {
        model: body.model,
        messageCount: messages.length,
        toolNames: Array.isArray(body.tools)
          ? body.tools.map((tool) => tool.name)
          : [],
        userMessages: messages
          .filter((message) => message.role === "user")
          .map((message) => contentText(message.content))
          .filter(Boolean),
      };
      console.log(
        JSON.stringify({
          event: "mock_message",
          messageCalls,
          responseType: selected.type,
          toolNames: lastRequest.toolNames,
          userMessages: lastRequest.userMessages,
        }),
      );

      const content =
        selected.type === "tool"
          ? [selected.tool]
          : [{ type: "text", text: selected.text }];
      const outputLength =
        selected.type === "tool" ? JSON.stringify(selected.tool).length : selected.text.length;

      sendJson(response, 200, {
        id: `msg_mock_${messageCalls}`,
        type: "message",
        role: "assistant",
        model: MODEL,
        content,
        stop_reason: selected.type === "tool" ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: Math.max(1, Math.ceil(JSON.stringify(messages).length / 4)),
          output_tokens: Math.max(1, Math.ceil(outputLength / 4)),
        },
      });
    } catch {
      sendJson(response, 400, {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "The mock could not parse the request.",
        },
      });
    }
    return;
  }

  sendJson(response, 404, {
    type: "error",
    error: { type: "not_found_error", message: "Not found" },
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Phase 4 Anthropic mock listening on ${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
