import { describe, expect, it, vi } from "vitest";
import { SlackBackend } from "../src/index";

describe("SlackBackend", () => {
  it("uses Slack Web API and preserves timestamps", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer test-token" });
      return Response.json({
        ok: true, channel: "C1", ts: "1711111111.000007",
        message: { ts: "1711111111.000007", text: "hello", user: "U_BOT" },
      });
    });
    const adapter = new SlackBackend({ token: "test-token", fetcher });
    const sent = await adapter.postMessage({ id: "U_TEST" }, { conversationId: "C1", text: "hello" });
    expect(sent).toMatchObject({ id: "1711111111.000007", text: "hello" });
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://slack.com/api/chat.postMessage");
  });
  it("surfaces permissions instead of swallowing API errors", async () => {
    const adapter = new SlackBackend({
      token: "test-token",
      fetcher: vi.fn(async () => Response.json({ ok: false, error: "missing_scope" })),
    });
    await expect(adapter.postMessage({ id: "U_TEST" }, { conversationId: "C1", text: "x" }))
      .rejects.toMatchObject({ code: "permission_denied" });
  });
  it("maps channel lists", async () => {
    const adapter = new SlackBackend({
      token: "test-token",
      fetcher: vi.fn(async () => Response.json({
        ok: true, channels: [{ id: "C1", name: "ops", is_private: false }],
        response_metadata: { next_cursor: "next" },
      })),
    });
    const page = await adapter.listConversations({ id: "U_TEST" });
    expect(page).toMatchObject({ items: [{ id: "C1", name: "ops", kind: "channel" }], nextCursor: "next" });
  });
});
