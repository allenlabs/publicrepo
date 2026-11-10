import { describe, expect, it } from "vitest";
import worker from "../src/index";

describe("Cloudflare Worker router", () => {
  it("has a public health check but no unauthenticated data access", async () => {
    const env = { CHAT_API_TOKEN: "a-secret" };
    const health = await worker.fetch(new Request("https://example.com/health"), env);
    expect(health.status).toBe(200);
    const forbidden = await worker.fetch(new Request("https://example.com/v1/conversations"), env);
    expect(forbidden.status).toBe(401);
  });
  it("uses a bearer token and rejects invalid tokens", async () => {
    const res = await worker.fetch(new Request("https://example.com/api/api.test", {
      method: "POST", headers: { Authorization: "Bearer wrong" },
    }), { CHAT_API_TOKEN: "right" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, error: "invalid_auth" });
  });
});
