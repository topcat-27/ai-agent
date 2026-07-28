import { createServer } from "node:http";

const PORT = 3_401;
const MODEL = "claude-sonnet-4-6";
let messageCalls = 0;
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

function chooseReply(messages) {
  const textMessages = messages.map((message) => ({
    role: message.role,
    text: contentText(message.content),
  }));
  const lastUser =
    [...textMessages].reverse().find((message) => message.role === "user")?.text ??
    "";
  const previousText = textMessages.slice(0, -1).map((message) => message.text).join("\n");

  if (/what is my launch called/i.test(lastUser)) {
    return /Lantern/i.test(previousText)
      ? "Your launch is called Lantern."
      : "I do not know the launch name yet.";
  }
  if (/called Lantern/i.test(lastUser)) {
    return "Got it — I will remember that your launch is called Lantern.";
  }
  if (/long response/i.test(lastUser)) {
    return "x".repeat(12_000);
  }
  return `Mock Claude reply: ${lastUser}`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/metrics") {
    sendJson(response, 200, { messageCalls, lastRequest });
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
      const reply = chooseReply(messages);
      messageCalls += 1;
      lastRequest = {
        model: body.model,
        messageCount: messages.length,
        userMessages: messages
          .filter((message) => message.role === "user")
          .map((message) => contentText(message.content)),
      };
      console.log(
        JSON.stringify({
          event: "mock_message",
          messageCalls,
          messageCount: messages.length,
          userMessages: lastRequest.userMessages,
        }),
      );

      sendJson(response, 200, {
        id: `msg_mock_${messageCalls}`,
        type: "message",
        role: "assistant",
        model: MODEL,
        content: [{ type: "text", text: reply }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: Math.max(1, JSON.stringify(messages).length / 4),
          output_tokens: Math.max(1, reply.length / 4),
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
  console.log(`Anthropic mock listening on ${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
