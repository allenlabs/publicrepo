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

/** Only the portion of Cloudflare's D1 interface used by this adapter. */
interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface D1Like {
  prepare(query: string): Statement;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  author_id: string;
  body: string;
  created_at: string;
  thread_id: string | null;
}

interface ConversationRow {
  id: string;
  name: string;
  kind: Conversation["kind"];
}

function messageFrom(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    authorId: row.author_id,
    text: row.body,
    createdAt: row.created_at,
    ...(row.thread_id ? { threadId: row.thread_id } : {}),
  };
}

function parseCursor(cursor: string): { createdAt: string; id: string } {
  const separator = cursor.indexOf("|");
  if (separator < 1 || separator === cursor.length - 1) {
    throw new ChatError("invalid_arguments", "Invalid message cursor");
  }
  return { createdAt: cursor.slice(0, separator), id: cursor.slice(separator + 1) };
}

function messageCursor(row: MessageRow): string {
  return row.created_at + "|" + row.id;
}

/** Generate Slack-style timestamps for first-party messages; D1 guarantees uniqueness. */
function newMessageId(): string {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  const millis = Date.now();
  const micros = ((millis % 1000) * 1000 + ((random[0] ?? 0) % 1000)).toString().padStart(6, "0");
  return Math.floor(millis / 1000) + "." + micros;
}

/**
 * Minimal single-tenant backend. The Worker currently authenticates one service
 * identity, NOT end users. Replace this boundary before opening multi-user access.
 */
export class D1Backend implements ChatBackend {
  readonly id = "cloudflare-d1";
  readonly capabilities = {
    threads: true,
    edits: false,
    reactions: false,
    attachments: false,
    realtime: false,
  } as const;

  constructor(private readonly db: D1Like) {}

  async listConversations(
    _principal: Principal,
    options: ListOptions = {},
  ): Promise<Page<Conversation>> {
    const limit = pageLimit(options.limit);
    const { results } = await this.db
      .prepare("SELECT id, name, kind FROM conversations WHERE id > ? ORDER BY id LIMIT ?")
      .bind(options.cursor ?? "", limit + 1)
      .all<ConversationRow>();
    return {
      items: results.slice(0, limit),
      ...(results.length > limit ? { nextCursor: results[limit - 1]!.id } : {}),
    };
  }

  async listMessages(
    _principal: Principal,
    conversationId: string,
    options: HistoryOptions = {},
  ): Promise<Page<ChatMessage>> {
    const limit = pageLimit(options.limit);
    const thread = options.threadId;
    const where = ["conversation_id = ?"];
    const args: unknown[] = [conversationId];
    if (thread) {
      where.push("(thread_id = ? OR id = ?)");
      args.push(thread, thread);
    }
    if (options.cursor) {
      const cursor = parseCursor(options.cursor);
      const compare = thread ? ">" : "<";
      where.push("(created_at " + compare + " ? OR (created_at = ? AND id " + compare + " ?))");
      args.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const query =
      "SELECT id, conversation_id, author_id, body, created_at, thread_id FROM messages WHERE " +
      where.join(" AND ") +
      " ORDER BY created_at " + (thread ? "ASC" : "DESC") +
      ", id " + (thread ? "ASC" : "DESC") + " LIMIT ?";
    const { results } = await this.db.prepare(query).bind(...args, limit + 1).all<MessageRow>();
    return {
      items: results.slice(0, limit).map(messageFrom),
      ...(results.length > limit ? { nextCursor: messageCursor(results[limit - 1]!) } : {}),
    };
  }

  async postMessage(principal: Principal, input: PostMessageInput): Promise<ChatMessage> {
    const room = await this.db
      .prepare("SELECT id FROM conversations WHERE id = ?")
      .bind(input.conversationId)
      .first<{ id: string }>();
    if (!room) throw new ChatError("not_found", "Conversation not found", 404);
    if (input.threadId) {
      const parent = await this.db
        .prepare("SELECT id FROM messages WHERE id = ? AND conversation_id = ? AND thread_id IS NULL")
        .bind(input.threadId, input.conversationId)
        .first<{ id: string }>();
      if (!parent) throw new ChatError("not_found", "Thread root not found", 404);
    }
    if (input.idempotencyKey) {
      const old = await this.findIdempotent(input, principal);
      if (old) return messageFrom(old);
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const id = newMessageId();
      const createdAt = new Date().toISOString();
      const result = await this.db
        .prepare("INSERT OR IGNORE INTO messages (id, conversation_id, author_id, body, created_at, thread_id, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(id, input.conversationId, principal.id, input.text, createdAt, input.threadId ?? null, input.idempotencyKey ?? null)
        .run();
      if (result.meta?.changes === 1) {
        return {
          id,
          conversationId: input.conversationId,
          authorId: principal.id,
          text: input.text,
          createdAt,
          ...(input.threadId ? { threadId: input.threadId } : {}),
        };
      }
      if (input.idempotencyKey) {
        const old = await this.findIdempotent(input, principal);
        if (old) return messageFrom(old);
      }
    }
    throw new ChatError("backend_error", "Unable to allocate message id", 503);
  }

  private async findIdempotent(
    input: PostMessageInput,
    principal: Principal,
  ): Promise<MessageRow | null> {
    return this.db
      .prepare("SELECT id, conversation_id, author_id, body, created_at, thread_id FROM messages WHERE conversation_id = ? AND author_id = ? AND idempotency_key = ?")
      .bind(input.conversationId, principal.id, input.idempotencyKey ?? null)
      .first<MessageRow>();
  }
}
