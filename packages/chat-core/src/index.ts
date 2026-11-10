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

/** Register backends at the composition root; domain code never imports providers. */
export class AdapterRegistry<Config> {
  private readonly factories = new Map<string, (config: Config) => ChatBackend>();

  register(id: string, factory: (config: Config) => ChatBackend): this {
    if (!id || this.factories.has(id)) {
      throw new ChatError("invalid_arguments", "Adapter id is missing or already registered: " + id);
    }
    this.factories.set(id, factory);
    return this;
  }

  create(id: string, config: Config): ChatBackend {
    const factory = this.factories.get(id);
    if (!factory) throw new ChatError("unsupported", "Unknown chat backend: " + id, 503);
    return factory(config);
  }

  names(): string[] {
    return [...this.factories.keys()];
  }
}

/**
 * Small application service. Deliberately knows nothing about Slack, Mattermost,
 * Cloudflare or Ember. Backend implementations MUST enforce resource permissions.
 */
export class ChatService {
  constructor(public readonly backend: ChatBackend) {}

  private checkPrincipal(principal: Principal): void {
    if (typeof principal.id !== "string" || principal.id.trim() === "") {
      throw new ChatError("unauthorized", "Missing identity", 401);
    }
  }

  async conversations(principal: Principal, options: ListOptions = {}): Promise<Page<Conversation>> {
    this.checkPrincipal(principal);
    return this.backend.listConversations(principal, { ...options, limit: pageLimit(options.limit) });
  }

  async history(
    principal: Principal,
    conversationId: string,
    options: HistoryOptions = {},
  ): Promise<Page<ChatMessage>> {
    this.checkPrincipal(principal);
    if (!conversationId) throw new ChatError("invalid_arguments", "conversationId is required");
    if (options.threadId && !this.backend.capabilities.threads) {
      throw new ChatError("unsupported", "Thread history is not supported by this backend", 501);
    }
    return this.backend.listMessages(principal, conversationId, {
      ...options,
      limit: pageLimit(options.limit),
    });
  }

  async send(principal: Principal, input: PostMessageInput): Promise<ChatMessage> {
    this.checkPrincipal(principal);
    if (!input.conversationId || typeof input.text !== "string" || !input.text.trim()) {
      throw new ChatError("invalid_arguments", "conversationId and nonempty text are required");
    }
    if (input.text.length > 10_000) {
      throw new ChatError("invalid_arguments", "Message too long (max 10000 characters)");
    }
    if (input.idempotencyKey && input.idempotencyKey.length > 128) {
      throw new ChatError("invalid_arguments", "Idempotency key too long");
    }
    if (input.threadId && !this.backend.capabilities.threads) {
      throw new ChatError("unsupported", "Thread replies are not supported by this backend", 501);
    }
    return this.backend.postMessage(principal, input);
  }
}
