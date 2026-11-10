import {
  ChatError,
  pageLimit,
  type ChatBackend,
  type ChatMessage,
  type Conversation,
  type HistoryOptions,
  type ListOptions,
  type Page,
  type PostMessageInput,
  type Principal,
} from "@allenlabs/chat-contracts";

export interface EmberRoom {
  id: string;
  name: string;
  key: string;
}

export interface EmberOptions {
  baseUrl: string;
  rooms: EmberRoom[];
  fetcher?: typeof fetch;
}

interface EmberMessage {
  id: string;
  created_at: string | number;
  creator: { id: string };
  room: { id: string };
  body: { plain_text?: string };
}

function convert(row: EmberMessage): ChatMessage {
  const n = Number(row.created_at);
  const time = Number.isFinite(n) && String(row.created_at).trim() !== ""
    ? new Date(n < 1e11 ? n * 1000 : n)
    : new Date(row.created_at);
  return {
    id: row.id,
    conversationId: row.room.id,
    authorId: row.creator.id,
    text: row.body.plain_text ?? "",
    createdAt: time.toISOString(),
  };
}

/**
 * Ember's room-scoped bot API, not an embedded Ember fork or native user auth.
 * Bot keys remain server-side. Thread operations and global room discovery
 * are intentionally not advertised.
 */
export class EmberBackend implements ChatBackend {
  readonly id = "ember";
  readonly capabilities = {
    threads: false,
    edits: false,
    reactions: false,
    attachments: false,
    realtime: false,
  } as const;
  private readonly origin: string;
  private readonly fetcher: typeof fetch;
  private readonly rooms: EmberRoom[];

  constructor(options: EmberOptions) {
    const url = new URL(options.baseUrl);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
      throw new ChatError("invalid_arguments", "Ember URL must use HTTPS");
    }
    if (!Array.isArray(options.rooms) || options.rooms.some((r) => !r.id || !r.name || !r.key)) {
      throw new ChatError("invalid_arguments", "Ember room configuration is invalid");
    }
    this.origin = url.origin;
    this.fetcher = options.fetcher ?? fetch;
    this.rooms = options.rooms;
  }

  private room(id: string): EmberRoom {
    const room = this.rooms.find((r) => r.id === id);
    if (!room) throw new ChatError("not_found", "Ember room is not configured", 404);
    return room;
  }

  private endpoint(room: EmberRoom): string {
    return this.origin + "/rooms/" + encodeURIComponent(room.id) + "/" +
      encodeURIComponent(room.key) + "/messages";
  }

  async listConversations(_principal: Principal, options: ListOptions = {}): Promise<Page<Conversation>> {
    const limit = pageLimit(options.limit);
    const offset = Number(options.cursor ?? "0");
    if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) {
      throw new ChatError("invalid_arguments", "Invalid Ember cursor");
    }
    return {
      items: this.rooms.slice(offset, offset + limit).map((r) => ({
        id: r.id, name: r.name, kind: "channel",
      })),
      ...(this.rooms.length > offset + limit ? { nextCursor: String(offset + limit) } : {}),
    };
  }

  async listMessages(
    _principal: Principal,
    conversationId: string,
    options: HistoryOptions = {},
  ): Promise<Page<ChatMessage>> {
    if (options.threadId) throw new ChatError("unsupported", "Ember bot API thread history is unavailable", 501);
    const room = this.room(conversationId);
    const query = options.cursor ? "?before=" + encodeURIComponent(options.cursor) : "";
    const response = await this.fetcher(this.endpoint(room) + query, { method: "GET" });
    if (response.status === 401 || response.status === 403) {
      throw new ChatError("unauthorized", "Ember bot key was rejected", 401);
    }
    if (!response.ok) throw new ChatError("backend_error", "Ember history failed", 502);
    const messages = await response.json() as EmberMessage[];
    if (!Array.isArray(messages)) throw new ChatError("backend_error", "Invalid Ember response", 502);
    const limit = pageLimit(options.limit);
    const link = response.headers.get("Link") ?? "";
    const nextLink = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1];
    const next = nextLink ? new URL(nextLink, this.origin).searchParams.get("before") : null;
    return {
      items: messages.slice(0, limit).map(convert),
      ...(next && messages.length <= limit ? { nextCursor: next } : {}),
    };
  }

  async postMessage(_principal: Principal, input: PostMessageInput): Promise<ChatMessage> {
    if (input.threadId) throw new ChatError("unsupported", "Ember bot API thread replies disabled", 501);
    const room = this.room(input.conversationId);
    const response = await this.fetcher(this.endpoint(room), {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: input.text,
    });
    if (response.status === 401 || response.status === 403) {
      throw new ChatError("unauthorized", "Ember bot key was rejected", 401);
    }
    if (response.status === 404) throw new ChatError("not_found", "Ember room missing", 404);
    if (response.status !== 201) throw new ChatError("backend_error", "Ember post failed", 502);
    const location = response.headers.get("Location");
    const id = location ? /\/@([^/?#]+)$/.exec(new URL(location, this.origin).pathname)?.[1] : null;
    if (!id) {
      throw new ChatError("backend_error", "Ember created a message but returned no recognizable id", 502);
    }
    return {
      id,
      conversationId: room.id,
      authorId: "ember-bot",
      text: input.text,
      createdAt: new Date().toISOString(),
    };
  }
}
