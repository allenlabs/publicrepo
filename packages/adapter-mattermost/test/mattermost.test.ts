import { describe, expect, it, vi } from "vitest";
import { MattermostBackend } from "../src/index";

describe("MattermostBackend", () => {
  it("posts a thread reply over Mattermost REST v4", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      expect(body).toMatchObject({ channel_id: "ch1", message: "hello", root_id: "root" });
      return Response.json({
        id: "post1", channel_id: "ch1", user_id: "mm-bot",
        message: "hello", create_at: 1700000000000, root_id: "root",
      });
    });
    const backend = new MattermostBackend({
      baseUrl: "https://mattermost.example.com", token: "mm-secret", teamId: "team1", fetcher,
    });
    const sent = await backend.postMessage({ id: "gateway" }, {
      conversationId: "ch1", text: "hello", threadId: "root",
    });
    expect(sent).toMatchObject({ id: "post1", threadId: "root", authorId: "mm-bot" });
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://mattermost.example.com/api/v4/posts");
  });

  it("maps channel history in provided order", async () => {
    const fetcher = vi.fn(async () => Response.json({
      order: ["b", "a"],
      posts: {
        a: { id: "a", channel_id: "ch1", user_id: "U", message: "old", create_at: 1000 },
        b: { id: "b", channel_id: "ch1", user_id: "U", message: "new", create_at: 2000 },
      },
    }));
    const backend = new MattermostBackend({
      baseUrl: "https://mattermost.example.com", token: "mm-secret", teamId: "team1", fetcher,
    });
    expect((await backend.listMessages({ id: "gateway" }, "ch1")).items.map((m) => m.id))
      .toEqual(["b", "a"]);
  });
});
