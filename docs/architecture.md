# Architecture

## Dependency direction

Applications (Workers HTTP router, future web UI / agent console) call portable core contracts. The core invokes ChatBackend interfaces; backend adapters provide storage or upstream API calls.

    Native HTTP / partial Slack Web API
                   |
               ChatService
                   |
               ChatBackend
          /        |        \
       D1       Slack      Mattermost       Ember

All adapters are registered at the Worker composition root. No Mattermost, Slack, Ember or Cloudflare SDK is imported by chat-contracts or chat-core.

## Separate these three concepts

1. **Backend adapter:** Source of truth for a channel's messages. Implemented: D1, Slack, Mattermost, Ember bot API.
2. **Inbound API facade:** Translates a client's API contract into ChatService. Implemented: limited Slack Web API and native REST.
3. **Bridge:** Synchronizes distinct backends bidirectionally, handling identity mapping, edits, deletions and loops. **Not implemented.** A backend adapter is not a bridge.

## Current supported capabilities

Each ChatBackend advertises threads, edits, reactions, attachments and realtime. The core rejects unsupported threads before dispatch. Unimplemented methods must never claim support.

## Security and data model

- Single service-token authentication at the Worker boundary only. No production-quality user identity/ACL layer yet.
- D1 SQL always binds request parameters, and message creation validates the existence of its conversation and thread root.
- First-party message IDs use timestamp-like identifiers for Slack ingress; other provider IDs remain native. Never assume these ID namespaces are globally compatible.
- Per-message idempotency keys are scoped to conversation and service identity in the D1 adapter.
- Backend credentials stay server-side in Wrangler secrets; never forward them to clients.
- No outbound webhook URL is accepted from public API requests; remote base URLs come from trusted deployment configuration.

## Next phases (not represented as implemented)

1. Add user sessions, tenant boundaries, channel membership authorization, audit logging and rate limiting.
2. Add a durable ID/identity mapping registry plus event envelopes with origin, hop limit and deduplication; only then build a bi-directional bridge.
3. Add Durable Objects for presence, WebSocket delivery and hibernation; keep storage and realtime transports independent.
4. Extend Slack compatibility with SDK conformance tests for edits, files, reactions, OAuth, Events API and Socket Mode.
5. Integrate Ember via its supported bot API and/or an upstream-preserving plugin boundary; avoid vendoring Ember.

Do not make an upstream Ember fork mandatory for core packages. If a future embedded-Ember implementation is required, keep the changes in a separate integration workspace and sync upstream independently.
