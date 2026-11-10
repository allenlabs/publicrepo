import assert from "node:assert/strict";

const origin = "http://127.0.0.1:8799";
const token = "replace-me-for-local-development";
const headers = { Authorization: "Bearer " + token };

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(origin + "/health");
      if (response.ok) return;
    } catch { /* Worker not ready yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Worker did not become healthy");
}

async function request(path, init = {}) {
  const response = await fetch(origin + path, {
    ...init, headers: { ...headers, ...(init.headers ?? {}) },
  });
  return { status: response.status, body: await response.json() };
}

await waitForHealth();
const unauth = await fetch(origin + "/v1/conversations");
assert.equal(unauth.status, 401);

const channels = await request("/v1/conversations");
assert.equal(channels.status, 200);
assert.ok(channels.body.items.some((c) => c.id === "general"));

const message = await request("/v1/conversations/general/messages", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Idempotency-Key": "smoke-1" },
  body: JSON.stringify({ text: "Hello from CI" }),
});
assert.equal(message.status, 201);
assert.match(message.body.id, /^\d+\.\d{6}$/);

const replay = await request("/v1/conversations/general/messages", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Idempotency-Key": "smoke-1" },
  body: JSON.stringify({ text: "Hello from CI" }),
});
assert.equal(replay.body.id, message.body.id);

const history = await request("/v1/conversations/general/messages");
assert.ok(history.body.items.some((m) => m.id === message.body.id));

const sdk = await request("/api/conversations.history", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ channel: "general" }).toString(),
});
assert.equal(sdk.body.ok, true);
assert.ok(sdk.body.messages.some((m) => m.ts === message.body.id));

console.log("Cloudflare Worker + D1 + Slack API smoke test passed");
