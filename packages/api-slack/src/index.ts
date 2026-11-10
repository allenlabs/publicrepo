import { ChatError, type ChatMessage, type Principal } from "@allenlabs/chat-contracts";
import { ChatService } from "@allenlabs/chat-core";

type Payload = Record<string, unknown>;
const json = (value: unknown): Response => Response.json(value, { headers: { "Cache-Control": "no-store" } });

function requireString(payload: Payload, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ChatError("invalid_arguments", key + " is required");
  }
  return value;
}

function optionalString(payload: Payload, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function parseLimit(payload: Payload): number | undefined {
  const value = payload.limit;
  if (value === undefined) return undefined;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new ChatError("invalid_arguments", "Invalid limit");
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw new ChatError("invalid_arguments", "Invalid limit");
  return n;
}

async function readPayload(request: Request): Promise<Payload> {
  const text = await request.text();
  if (!text) return {};
  if (request.headers.get("content-type")?.includes("application/json")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Payload;
      }
    } catch {
      // Below: return a Slack-shaped error, not an exception.
    }
    throw new ChatError("invalid_arguments", "Invalid JSON");
  }
  return Object.fromEntries(new URLSearchParams(text));
}

function asSlackMessage(message: ChatMessage): Payload {
  return {
    type: "message",
    ts: message.id,
    text: message.text,
    user: message.authorId,
    ...(message.threadId ? { thread_ts: message.threadId } : {}),
  };
}

function slackError(error: unknown): string {
  if (!(error instanceof ChatError)) return "internal_error";
  if (error.code === "not_found") return "channel_not_found";
  if (error.code === "permission_denied") return "not_in_channel";
  if (error.code === "unauthorized") return "invalid_auth";
  if (error.code === "unsupported") return "not_supported";
  if (error.code === "backend_error") return "internal_error";
  return "invalid_arguments";
}

/**
 * Deliberately a SMALL subset of Slack Web API, not Slack OAuth, RTM or
 * Socket Mode. The worker only enables this facade for its own D1 backend,
 * where native message identifiers use Slack's timestamp shape.
 */
export async function handleSlackApi(
  request: Request,
  service: ChatService,
  principal: Principal,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const method = path.startsWith("/api/") ? path.slice(5) : "";
  if (request.method !== "POST") return json({ ok: false, error: "method_not_supported" });
  try {
    const input = await readPayload(request);
    switch (method) {
      case "api.test":
        return json({ ok: true });
      case "auth.test":
        return json({
          ok: true,
          url: new URL(request.url).origin + "/",
          team: "Allenlabs Chat",
          user: principal.id,
          team_id: "TLOCAL",
          user_id: principal.id,
        });
      case "conversations.list": {
        const page = await service.conversations(principal, {
          cursor: optionalString(input, "cursor"),
          limit: parseLimit(input),
        });
        return json({
          ok: true,
          channels: page.items.map((c) => ({
            id: c.id,
            name: c.name,
            is_channel: c.kind === "channel",
            is_private: c.kind === "private",
            is_im: c.kind === "direct",
          })),
          response_metadata: { next_cursor: page.nextCursor ?? "" },
        });
      }
      case "chat.postMessage": {
        const message = await service.send(principal, {
          conversationId: requireString(input, "channel"),
          text: requireString(input, "text"),
          threadId: optionalString(input, "thread_ts"),
          idempotencyKey: optionalString(input, "client_msg_id"),
        });
        return json({
          ok: true,
          channel: message.conversationId,
          ts: message.id,
          message: asSlackMessage(message),
        });
      }
      case "conversations.history":
      case "conversations.replies": {
        const thread = method === "conversations.replies";
        const page = await service.history(principal, requireString(input, "channel"), {
          cursor: optionalString(input, "cursor"),
          limit: parseLimit(input),
          ...(thread ? { threadId: requireString(input, "ts") } : {}),
        });
        return json({
          ok: true,
          messages: page.items.map(asSlackMessage),
          has_more: !!page.nextCursor,
          response_metadata: { next_cursor: page.nextCursor ?? "" },
        });
      }
      default:
        return json({ ok: false, error: "method_not_supported" });
    }
  } catch (error) {
    return json({ ok: false, error: slackError(error) });
  }
}
