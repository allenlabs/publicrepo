/**
 * Portable chat contract. Platform SDK types never appear in this package.
 * Authentication, authorization and membership enforcement remain the backend's duty.
 */
export interface Principal {
  id: string;
}

export type ConversationKind = "channel" | "private" | "direct";

export interface Conversation {
  id: string;
  name: string;
  kind: ConversationKind;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  authorId: string;
  text: string;
  createdAt: string;
  threadId?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface ListOptions {
  cursor?: string;
  limit?: number;
}

export interface HistoryOptions extends ListOptions {
  threadId?: string;
}

export interface PostMessageInput {
  conversationId: string;
  text: string;
  threadId?: string;
  idempotencyKey?: string;
}

export interface Capabilities {
  threads: boolean;
  edits: boolean;
  reactions: boolean;
  attachments: boolean;
  realtime: boolean;
}

export type ChatErrorCode =
  | "invalid_arguments"
  | "unauthorized"
  | "permission_denied"
  | "not_found"
  | "unsupported"
  | "backend_error";

export class ChatError extends Error {
  constructor(
    public readonly code: ChatErrorCode,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "ChatError";
  }
}

export interface ChatBackend {
  readonly id: string;
  readonly capabilities: Readonly<Capabilities>;
  listConversations(principal: Principal, options?: ListOptions): Promise<Page<Conversation>>;
  listMessages(
    principal: Principal,
    conversationId: string,
    options?: HistoryOptions,
  ): Promise<Page<ChatMessage>>;
  postMessage(principal: Principal, input: PostMessageInput): Promise<ChatMessage>;
}

/** Shared pagination limits across all adapters, including remote upstreams. */
export function pageLimit(value: number | undefined): number {
  if (value === undefined) return 20;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new ChatError("invalid_arguments", "limit must be an integer between 1 and 100");
  }
  return value;
}
