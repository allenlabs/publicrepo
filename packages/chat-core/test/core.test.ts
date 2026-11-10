import { describe, expect, it } from "vitest";
import {
  ChatError,
  type ChatBackend,
  type ChatMessage,
  type Conversation,
  type Page,
  type Principal,
} from "@allenlabs/chat-contracts";
import { AdapterRegistry, ChatService } from "../src/index";

const user: Principal = { id: "U_TEST" };
const message: ChatMessage = {
  id: "123.456789",
  conversationId: "general",
  authorId: "U_TEST",
  text: "hello",
  createdAt: "2026-11-10T00:00:00.000Z",
};
function backend(): ChatBackend {
  return {
    id: "test",
    capabilities: { threads: false, edits: false, reactions: false, attachments: false, realtime: false },
    async listConversations(): Promise<Page<Conversation>> {
      return { items: [{ id: "general", name: "general", kind: "channel" }] };
    },
    async listMessages() { return { items: [message] }; },
    async postMessage(_who, input) { return { ...message, text: input.text }; },
  };
}

describe("ChatService", () => {
  it("validates messages before dispatch", async () => {
    const service = new ChatService(backend());
    await expect(service.send(user, { conversationId: "general", text: "" }))
      .rejects.toMatchObject({ code: "invalid_arguments" });
    await expect(service.send(user, { conversationId: "general", text: "x", threadId: "a" }))
      .rejects.toMatchObject({ code: "unsupported" });
    await expect(service.send({ id: "" }, { conversationId: "general", text: "x" }))
      .rejects.toMatchObject({ code: "unauthorized" });
  });

  it("keeps the same API across adapters", async () => {
    const service = new ChatService(backend());
    expect((await service.conversations(user)).items[0]?.name).toBe("general");
    expect((await service.send(user, { conversationId: "general", text: "reusable" })).text).toBe("reusable");
  });

  it("uses a typed registry without changing the core", () => {
    const registry = new AdapterRegistry<{ backend: ChatBackend }>();
    registry.register("my-custom-provider", (env) => env.backend);
    expect(registry.create("my-custom-provider", { backend: backend() }).id).toBe("test");
    expect(() => registry.create("missing", { backend: backend() })).toThrow(ChatError);
    expect(() => registry.register("my-custom-provider", () => backend())).toThrow(ChatError);
  });
});
