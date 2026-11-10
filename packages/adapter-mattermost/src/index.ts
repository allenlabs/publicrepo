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

interface MattermostOptions {
  baseUrl: string;
  token: string;
  teamId: string;
  fetcher?: typeof fetch;
}

interface MattermostPost {
  id: string;
  channel_id: string;
  user_id: string;
  message: string;
  create_at: number;
  root_id?: string;
}

interface MattermostPostList {
  order: string[];
  posts: Record<string, MattermostPost>;
}

function mapPost(post: MattermostPost): ChatMessage {
  return {
    id: post.id,
    conversationId: post.channel_id,
    authorId: post.user_id,
    text: post.message,
    createdAt: new Date(post.create_at).toISOString(),
    ...(post.root_id ? { threadId: post.root_id } : {}),
  };
}

/** Mattermost REST v4 adapter; uses a configured service account token. */
export class MattermostBackend implements ChatBackend {
  readonly id = "mattermost";
  readonly capabilities = {
    threads: true,
    edits: false,
    reactions: false,
    attachments: false,
    realtime: false,
  } as const;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: MattermostOptions) {
    if (!options.token || !options.teamId) {
      throw new ChatError("backend_error", "Mattermost token and teamId required", 503);
    }
    const url = new URL(options.baseUrl);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new ChatError("invalid_arguments", "Mattermost URL must use HTTPS");
    }
    this.baseUrl = url.origin + url.pathname.replace(/\/+$/, "");
    this.fetcher = options.fetcher ?? fetch;
  }

  private async call<T>(path: string, payload?: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(this.baseUrl + "/api/v4" + path, {
        method: payload ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + this.options.token,
          ...(payload ? { "Content-Type": "application/json" } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
    } catch {
      throw new ChatError("backend_error", "Mattermost request failed", 502);
    }
    if (response.status === 401) throw new ChatError("unauthorized", "Mattermost credential rejected", 401);
    if (response.status === 403) throw new ChatError("permission_denied", "Mattermost permission denied", 403);
    if (response.status === 404) throw new ChatError("not_found", "Mattermost resource not found", 404);
    if (!response.ok) throw new ChatError("backend_error", "Mattermost HTTP " + response.status, 502);
    return response.json() as Promise<T>;
  }

  async listConversations(_principal: Principal, options: ListOptions = {}): Promise<Page<Conversation>> {
    const limit = pageLimit(options.limit);
    const cursor = Number(options.cursor ?? "0");
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > 100_000) {
      throw new ChatError("invalid_arguments", "Invalid Mattermost cursor");
    }
    const channels = await this.call<Array<{
      id: string; name: string; display_name?: string; type?: string;
    }>>("/users/me/teams/" + encodeURIComponent(this.options.teamId) + "/channels");
    const page = channels.slice(cursor, cursor + limit);
    return {
      items: page.map((c) => ({
        id: c.id,
        name: c.display_name || c.name,
        kind: c.type === "D" || c.type === "G" ? "direct" : c.type === "P" ? "private" : "channel",
      })),
      ...(channels.length > cursor + limit ? { nextCursor: String(cursor + limit) } : {}),
    };
  }

  async listMessages(
    _principal: Principal,
    conversationId: string,
    options: HistoryOptions = {},
  ): Promise<Page<ChatMessage>> {
    const limit = pageLimit(options.limit);
    if (options.threadId) {
      // Mattermost's thread pagination uses fromPost, not page numbers.
      const params = new URLSearchParams({ perPage: String(limit + 1) });
      if (options.cursor) params.set("fromPost", options.cursor);
      const data = await this.call<MattermostPostList>(
        "/posts/" + encodeURIComponent(options.threadId) + "/thread?" + params,
      );
      const ordered = data.order.map((id) => data.posts[id]).filter((p): p is MattermostPost => !!p);
      const nonDuplicate = options.cursor ? ordered.filter((p) => p.id !== options.cursor) : ordered;
      return {
        items: nonDuplicate.slice(0, limit).map(mapPost),
        ...(nonDuplicate.length > limit ? { nextCursor: nonDuplicate[limit - 1]!.id } : {}),
      };
    }
    const page = Number(options.cursor ?? "0");
    if (!Number.isInteger(page) || page < 0 || page > 100_000) {
      throw new ChatError("invalid_arguments", "Invalid Mattermost cursor");
    }
    const data = await this.call<MattermostPostList>(
      "/channels/" + encodeURIComponent(conversationId) + "/posts?page=" +
        page + "&per_page=" + (limit + 1),
    );
    const ordered = data.order.map((id) => data.posts[id]).filter((p): p is MattermostPost => !!p);
    return {
      items: ordered.slice(0, limit).map(mapPost),
      ...(ordered.length > limit ? { nextCursor: String(page + 1) } : {}),
    };
  }

  async postMessage(_principal: Principal, input: PostMessageInput): Promise<ChatMessage> {
    const post = await this.call<MattermostPost>("/posts", {
      channel_id: input.conversationId,
      message: input.text,
      ...(input.threadId ? { root_id: input.threadId } : {}),
    });
    return mapPost(post);
  }
}
