import { D1Backend, type D1Like } from "@allenlabs/adapter-d1";
import { ChatError, type ChatBackend, type Principal } from "@allenlabs/chat-contracts";
import { AdapterRegistry, ChatService } from "@allenlabs/chat-core";
import { SlackBackend } from "@allenlabs/adapter-slack";
import { MattermostBackend } from "@allenlabs/adapter-mattermost";
import { EmberBackend, type EmberRoom } from "@allenlabs/adapter-ember";
import { handleSlackApi } from "@allenlabs/api-slack";

export interface Env {
  DB?: D1Like;
  CHAT_BACKEND?: string;
  CHAT_API_TOKEN?: string;
  CHAT_ACTOR_ID?: string;
  SLACK_BOT_TOKEN?: string;
  MATTERMOST_URL?: string;
  MATTERMOST_TOKEN?: string;
  MATTERMOST_TEAM_ID?: string;
  EMBER_URL?: string;
  EMBER_ROOMS_JSON?: string;
}

const json = (value: unknown, status = 200): Response =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

async function allowed(request: Request, expected?: string): Promise<boolean> {
  const bearer = /^Bearer (.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!bearer || !expected) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(bearer)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i]! ^ b[i]!;
  return difference === 0;
}

const registry = new AdapterRegistry<Env>()
  .register("d1", (env) => {
    if (!env.DB) throw new ChatError("backend_error", "D1 is not configured", 503);
    return new D1Backend(env.DB);
  })
  .register("slack", (env) => {
    if (!env.SLACK_BOT_TOKEN) throw new ChatError("backend_error", "SLACK_BOT_TOKEN is missing", 503);
    return new SlackBackend({ token: env.SLACK_BOT_TOKEN });
  })
  .register("ember", (env) => {
    if (!env.EMBER_URL || !env.EMBER_ROOMS_JSON) {
      throw new ChatError("backend_error", "Ember configuration is incomplete", 503);
    }
    let rooms: unknown;
    try { rooms = JSON.parse(env.EMBER_ROOMS_JSON); } catch {
      throw new ChatError("backend_error", "EMBER_ROOMS_JSON is malformed", 503);
    }
    if (!Array.isArray(rooms)) {
      throw new ChatError("backend_error", "EMBER_ROOMS_JSON must be an array", 503);
    }
    return new EmberBackend({ baseUrl: env.EMBER_URL, rooms: rooms as EmberRoom[] });
  })
  .register("mattermost", (env) => {
    if (!env.MATTERMOST_URL || !env.MATTERMOST_TOKEN || !env.MATTERMOST_TEAM_ID) {
      throw new ChatError("backend_error", "Mattermost configuration is incomplete", 503);
    }
    return new MattermostBackend({
      baseUrl: env.MATTERMOST_URL,
      token: env.MATTERMOST_TOKEN,
      teamId: env.MATTERMOST_TEAM_ID,
    });
  });

function buildBackend(env: Env): ChatBackend {
  return registry.create(env.CHAT_BACKEND ?? "d1", env);
}

function parseLimit(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (value.trim() === "") throw new ChatError("invalid_arguments", "Invalid limit");
  return Number(value);
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health" && request.method === "GET") {
    return json({ status: "ok", backend: env.CHAT_BACKEND ?? "d1" });
  }
  if (!await allowed(request, env.CHAT_API_TOKEN)) {
    if (url.pathname.startsWith("/api/")) return json({ ok: false, error: "invalid_auth" }, 401);
    return json({ error: "unauthorized" }, 401);
  }
  const service = new ChatService(buildBackend(env));
  const principal: Principal = { id: env.CHAT_ACTOR_ID ?? "U_GATEWAY" };

  if (url.pathname.startsWith("/api/")) {
    if ((env.CHAT_BACKEND ?? "d1") !== "d1") {
      return json({ ok: false, error: "not_supported" }, 501);
    }
    return handleSlackApi(request, service, principal);
  }

  if (url.pathname === "/v1/conversations" && request.method === "GET") {
    return json(await service.conversations(principal, {
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: parseLimit(url.searchParams.get("limit")),
    }));
  }
  const match = /^\/v1\/conversations\/([^/]+)\/messages$/.exec(url.pathname);
  if (match) {
    let conversationId: string;
    try {
      conversationId = decodeURIComponent(match[1]!);
    } catch {
      throw new ChatError("invalid_arguments", "Invalid conversation ID");
    }
    if (request.method === "GET") {
      return json(await service.history(principal, conversationId, {
        cursor: url.searchParams.get("cursor") ?? undefined,
        threadId: url.searchParams.get("thread_id") ?? undefined,
        limit: parseLimit(url.searchParams.get("limit")),
      }));
    }
    if (request.method === "POST") {
      let body: unknown;
      try { body = await request.json(); } catch {
        throw new ChatError("invalid_arguments", "Invalid JSON body");
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new ChatError("invalid_arguments", "JSON object expected");
      }
      const value = body as Record<string, unknown>;
      return json(await service.send(principal, {
        conversationId,
        text: value.text as string,
        ...(typeof value.threadId === "string" ? { threadId: value.threadId } : {}),
        ...(request.headers.get("Idempotency-Key")
          ? { idempotencyKey: request.headers.get("Idempotency-Key")! }
          : {}),
      }), 201);
    }
  }
  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (error) {
      if (error instanceof ChatError) {
        if (new URL(request.url).pathname.startsWith("/api/")) {
          return json({ ok: false, error: error.code }, error.status);
        }
        return json({ error: error.code, message: error.message }, error.status);
      }
      // Avoid exposing upstream response bodies, secrets, and stack traces.
      console.error("Chat gateway request failed", error instanceof Error ? error.name : "unknown");
      return json({ error: "internal_error" }, 500);
    }
  },
};
