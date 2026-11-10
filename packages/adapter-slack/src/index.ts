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

interface SlackOptions {
  token: string;
  apiUrl?: string;
  fetcher?: typeof fetch;
}

interface SlackResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

interface SlackMessage {
  ts: string;
  text?: string;
  user?: string;
  bot_id?: string;
  thread_ts?: string;
}

function fromSlack(message: SlackMessage, conversationId: string): ChatMessage {
  const time = Number(message.ts) * 1000;
  return {
    id: message.ts,
    conversationId,
    authorId: message.user ?? message.bot_id ?? "unknown",
    text: message.text ?? "",
    createdAt: new Date(Number.isFinite(time) ? time : 0).toISOString(),
    ...(message.thread_ts && message.thread_ts !== message.ts
      ? { threadId: message.thread_ts } : {}),
  };
}

/** Server-side Slack connector; acts as its configured bot, never impersonates users. */
export class SlackBackend implements ChatBackend {
  readonly id = "slack";
  readonly capabilities = {
    threads: true,
    edits: false,
    reactions: false,
    attachments: false,
    realtime: false,
  } as const;
  private readonly fetcher: typeof fetch;
  private readonly apiUrl: string;

  constructor(private readonly options: SlackOptions) {
    if (!options.token) throw new ChatError("backend_error", "Slack token is missing", 503);
    this.fetcher = options.fetcher ?? fetch;
    this.apiUrl = (options.apiUrl ?? "https://slack.com/api/").replace(/\/?$/, "/");
    const base = new URL(this.apiUrl);
    if (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1") {
      throw new ChatError("invalid_arguments", "Slack API URL must use HTTPS");
    }
  }

  private async call<T extends SlackResponse>(method: string, body: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(this.apiUrl + method, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + this.options.token,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ChatError("backend_error", "Slack request failed", 502);
    }
    if (!response.ok) throw new ChatError("backend_error", "Slack HTTP " + response.status, 502);
    const data = await response.json() as T;
    if (!data.ok) {
      const error = data.error ?? "unknown";
      if (error === "invalid_auth" || error === "token_revoked") {
        throw new ChatError("unauthorized", "Slack credential rejected", 401);
      }
      if (error === "not_in_channel" || error === "missing_scope") {
        throw new ChatError("permission_denied", "Slack permission denied", 403);
      }
      if (error === "channel_not_found") throw new ChatError("not_found", "Channel not found", 404);
      throw new ChatError("backend_error", "Slack API error: " + error, 502);
    }
    return data;
  }

  async listConversations(_principal: Principal, options: ListOptions = {}): Promise<Page<Conversation>> {
    const data = await this.call<SlackResponse & {
      channels?: { id: string; name?: string; is_private?: boolean; is_im?: boolean }[];
      response_metadata?: { next_cursor?: string };
    }>("conversations.list", {
      limit: pageLimit(options.limit),
      types: "public_channel,private_channel,im,mpim",
      ...(options.cursor ? { cursor: options.cursor } : {}),
    });
    return {
      items: (data.channels ?? []).map((c) => ({
        id: c.id,
        name: c.name ?? c.id,
        kind: c.is_im ? "direct" : c.is_private ? "private" : "channel",
      })),
      ...(data.response_metadata?.next_cursor ? { nextCursor: data.response_metadata.next_cursor } : {}),
    };
  }

  async listMessages(
    _principal: Principal,
    conversationId: string,
    options: HistoryOptions = {},
  ): Promise<Page<ChatMessage>> {
    const data = await this.call<SlackResponse & {
      messages?: SlackMessage[];
      response_metadata?: { next_cursor?: string };
    }>(options.threadId ? "conversations.replies" : "conversations.history", {
      channel: conversationId,
      limit: pageLimit(options.limit),
      ...(options.threadId ? { ts: options.threadId } : {}),
      ...(options.cursor ? { cursor: options.cursor } : {}),
    });
    return {
      items: (data.messages ?? []).map((m) => fromSlack(m, conversationId)),
      ...(data.response_metadata?.next_cursor ? { nextCursor: data.response_metadata.next_cursor } : {}),
    };
  }

  async postMessage(_principal: Principal, input: PostMessageInput): Promise<ChatMessage> {
    const data = await this.call<SlackResponse & {
      ts?: string;
      channel?: string;
      message?: SlackMessage;
    }>("chat.postMessage", {
      channel: input.conversationId,
      text: input.text,
      ...(input.threadId ? { thread_ts: input.threadId } : {}),
      ...(input.idempotencyKey ? { client_msg_id: input.idempotencyKey } : {}),
    });
    if (!data.ts) throw new ChatError("backend_error", "Slack did not return a timestamp", 502);
    return fromSlack(data.message ?? { ts: data.ts, text: input.text }, data.channel ?? input.conversationId);
  }
}
