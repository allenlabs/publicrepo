# Allenlabs Modular Chat Gateway

Cloudflare Workers-native prototype for a reusable chat contract, interchangeable backends, and a deliberately limited Slack Web API facade. This is **not** a fork of Ember and is **not** a complete Slack replacement.

## What works

| Component | State |
| --- | --- |
| Portable chat contracts and adapter registry | Implemented |
| Cloudflare D1: channels, messages, thread replies, pagination, idempotency | Implemented |
| Slack outbound connector (Web API) | Implemented |
| Mattermost outbound connector (REST v4) | Implemented |
| Ember outbound connector (room-scoped bot API) | Implemented; no thread support |
| Slack-compatible inbound API | Subset: auth.test, api.test, conversations.list, conversations.history, conversations.replies, chat.postMessage |
| Real-time sockets, user login, member authorization, Slack OAuth, Socket Mode | Not implemented |

## Run locally

Requirements: Node.js 22+, pnpm 10.

1. Run `corepack enable` and `pnpm install`.
2. Copy `apps/worker/.dev.vars.example` to `apps/worker/.dev.vars` and replace the sample API token.
3. Run `pnpm --filter @allenlabs/chat-worker db:local`.
4. Run `pnpm --filter @allenlabs/chat-worker dev`.
5. Run `pnpm check` to run TypeScript, unit tests and a Worker bundling dry run.

The default D1 migration creates the `general` channel. Example requests:

```bash
curl -H 'Authorization: Bearer YOUR_LOCAL_TOKEN' http://localhost:8787/v1/conversations
curl -X POST http://localhost:8787/v1/conversations/general/messages \
  -H 'Authorization: Bearer YOUR_LOCAL_TOKEN' -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: my-request-1' -d '{"text":"hello"}'
curl -X POST http://localhost:8787/api/conversations.history \
  -H 'Authorization: Bearer YOUR_LOCAL_TOKEN' -d 'channel=general'
```

## Select a backend

Configure `CHAT_BACKEND` in Wrangler vars as one of: `d1` (default), `slack`, `mattermost`, `ember`. Remote backend credentials belong in Cloudflare secrets, never public vars.

| Backend | Required settings | Notes |
| --- | --- | --- |
| d1 | DB binding | First-party storage; supports the Slack ingress subset |
| slack | SLACK_BOT_TOKEN | Acts as the configured bot; scopes are enforced by Slack |
| mattermost | MATTERMOST_URL, MATTERMOST_TOKEN, MATTERMOST_TEAM_ID | Acts as the configured service user |
| ember | EMBER_URL, EMBER_ROOMS_JSON | Bot keys per configured room; limited to bot API |

Example `EMBER_ROOMS_JSON` secret value: `[{"id":"room-id","name":"general","key":"BOT_KEY"}]`.

## Deploy to Cloudflare

1. `cd apps/worker && pnpm exec wrangler d1 create allenlabs-chat-platform` (for the d1 backend).
2. Replace the placeholder `database_id` in `apps/worker/wrangler.jsonc` with the returned ID.
3. `pnpm exec wrangler d1 migrations apply DB --remote`.
4. `pnpm exec wrangler secret put CHAT_API_TOKEN`; set any backend-specific credentials as additional secrets.
5. `pnpm exec wrangler deploy`.

**Security limitation:** this initial version authenticates a *single service account* via `CHAT_API_TOKEN`. It does not authenticate end users or enforce per-user memberships. Keep it private/restricted behind your infrastructure and do not expose it as a multi-tenant production messenger. Remote adapter calls use the configured bot or service credentials, not delegated user identities.

**Slack compatibility limitation:** the `/api/*` ingress only operates with the first-party D1 backend, whose message IDs have a Slack timestamp shape. Other backends need a persistent ID translation layer before they can safely expose Slack Web API semantics. No complete Slack client, OAuth, or app compatibility is claimed.

Architecture and extension instructions: [docs/architecture.md](docs/architecture.md) and [docs/adapter-guide.md](docs/adapter-guide.md).

## License

MIT (see [LICENSE](LICENSE)). No third-party chat server source code has been copied into this repository.
