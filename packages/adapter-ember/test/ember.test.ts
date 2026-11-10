import { describe, expect, it, vi } from "vitest";
import { EmberBackend } from "../src/index";

const options = {
  baseUrl: "https://ember.example.com",
  rooms: [{ id: "room1", name: "general", key: "SECRET_KEY" }],
};

describe("EmberBackend", () => {
  it("uses configured room-scoped bot API to post", async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 201,
      headers: { Location: "https://ember.example.com/rooms/room1/@message1" },
    }));
    const backend = new EmberBackend({ ...options, fetcher });
    const result = await backend.postMessage({ id: "service" }, {
      conversationId: "room1", text: "hello",
    });
    expect(result.id).toBe("message1");
    expect(fetcher.mock.calls[0]?.[0]).toContain("/rooms/room1/SECRET_KEY/messages");
  });
  it("rejects unconfigured rooms and reports restricted capabilities", async () => {
    const backend = new EmberBackend({ ...options, fetcher: vi.fn() });
    expect(backend.capabilities.threads).toBe(false);
    await expect(backend.postMessage({ id: "service" }, {
      conversationId: "not-configured", text: "hello",
    })).rejects.toMatchObject({ code: "not_found" });
  });
});
