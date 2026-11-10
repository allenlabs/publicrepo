# Adapter authoring guide

## Contract

Implement the `ChatBackend` interface from `@allenlabs/chat-contracts`: backend id, capabilities, listConversations, listMessages and postMessage.

Every adapter must:

- Preserve stable message/conversation IDs and cursor ordering.
- Enforce upstream permissions or define an explicit trusted service-identity boundary.
- Normalize errors to ChatError (unauthorized, permission_denied, not_found, unsupported, backend_error).
- Return only the capabilities it actually implements.
- Keep vendor-specific SDK types inside its own package.
- Treat outbound URL and tokens as trusted server-side deployment configuration; no public arbitrary-URL proxy.
- Include mocked API unit tests and, ideally, contract tests against the real vendor in a separate environment.

## Register a new adapter

1. Create `packages/adapter-myplatform` exporting a ChatBackend implementation.
2. Add a workspace dependency in `apps/worker/package.json`.
3. Register it in the `AdapterRegistry` in `apps/worker/src/index.ts` using configuration supplied from Worker secrets/vars.
4. Add a backend option in the README and an adapter test.

Registration is a composition-root change. Neither `chat-core` nor `chat-contracts` should change for a new platform.

## Example

```ts
import { AdapterRegistry } from '@allenlabs/chat-core';
const registry = new AdapterRegistry<{ token: string }>();
registry.register('myplatform', (config) => new MyPlatformBackend(config.token));
const backend = registry.create('myplatform', { token: env.API_TOKEN });
```

Do not claim API compatibility merely because an adapter can send messages. A Slack-compatible *server* must separately implement Slack request parsing, IDs, response shapes, auth/scope and callback semantics.
