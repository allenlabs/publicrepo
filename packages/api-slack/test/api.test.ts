import { describe, expect, it } from "vitest";
import type { ChatBackend } from "@allenlabs/chat-contracts";
import { ChatService } from "@allenlabs/chat-core";
import { handleSlackApi } from "../src/index";

const backend: ChatBackend = {
  id: "test-d1",
  capabilities: { threads: true, edits: false, reactions: false, attachments: false, realtime: false },
  async listConversations() {
    return { items: [{ id: "general", name: "general", kind: "channel" as const }] };
  },
  async listMessages() {
    return { items: [{
      id: "1700000000.123456", conversationId: "general",
      authorId: "U_GATEWAY", text: "message", createdAt: "2026-11-10T00:00:00.000Z",
    }] };
  },
  async postMessage(_who, input) {
    return {
      id: "1700000000.123456", conversationId: input.conversationId,
      authorId: "U_GATEWAY", text: input.text,
      createdAt: "2026-11-10T00:00:00.000Z",
    };
  },
};
const service = new ChatService(backend);
const user = { id: "U_GATEWAY" };

async function call(method: string, input: unknown, json = true): Promise<Record<string, unknown>> {
  const request = new Request("https://chat.example.com/api/" + method, {
    method: "POST",
    headers: { "content-type": json ? "application/json" : "application/x-www-form-urlencoded" },
    body: json ? JSON.stringify(input) : new URLSearchParams(input as Record<string, string>),
  });
  return await (await handleSlackApi(request, service, user)).json() as Record<string, unknown>;
}

describe("Slack ingress (partial Web API)", () => {
  it("supports SDK-style form posts", async () => {
    const result = await call("chat.postMessage", { channel: "general", text: "hello" }, false);
    expect(result).toMatchObject({ ok: true, channel: "general", ts: "1700000000.123456" });
  });
  it("supports conversations.list and history", async () => {
    expect((await call("conversations.list", {})).channels).toEqual([expect.objectContaining({ id: "general" })]);
    expect((await call("conversations.history", { channel: "general" })).messages)
      .toEqual([expect.objectContaining({ text: "message" })]);
  });
  it("rejects invalid requests and unsupported methods", async () => {
    expect(await call("chat.postMessage", { channel: "general" })).toMatchObject({ ok: false, error: "invalid_arguments" });
    expect(await call("users.profile.set", {})).toMatchObject({ ok: false, error: "method_not_supported" });
  });
});
