# ADR 0004: LLM behind an interface, off by default, behind a spend gate

- Status: accepted
- Date: 2026-11-17

## Context

Phase 2 drafts scripts with an LLM. Rules 8 and 9 require spend limits that are never raised
automatically and a provider that can be swapped. The owner chose Claude (Anthropic) as the first
provider, with no call made until they configure a key and a spend limit above 0.

## Decision

- `LlmProvider` (`packages/connectors/src/llm`) is the only contract the app uses. Implementations:
  `DisabledLlmProvider` (default), `FakeLlmProvider` (local and tests), `AnthropicLlmProvider`.
- The worker picks one with `LLM_PROVIDER`. The real one needs `LLM_API_KEY_REF`, a secret
  reference resolved through `SecretStore` (ADR 0003); a raw key is rejected by config validation.
- Every call goes through `generateWithSpendGate` (`packages/jobs/src/llm`): under a single
  Postgres advisory lock it checks the worst-case cost against the daily and monthly limits in
  `system_controls` (Europe/Madrid calendar), calls the provider and records `llm_usage`.
  Limits default to 0, which blocks every call.
- Costs are estimated on the safe side: USD list prices are used as EUR, cache discounts are
  ignored, input tokens are bounded by text length / 2, and an unknown answering model is priced at
  the highest known rate. A timeout records the worst case, because it may have been billed.
- The Anthropic adapter uses structured JSON output, no SDK retries (the queue retries through the
  gate) and server-side refusal fallbacks (`fallbacks: "default"`); a refusal becomes
  `CONTENT_REFUSED` and is not retried automatically.
- `llm_usage` never stores prompts or outputs.

## Consequences

- Turning the LLM on is two owner actions: provide the key through the secret store and raise the
  spend limits. Nothing in code raises them.
- Prices live in code and must be reviewed when Anthropic changes them or a new model is used.
- Pending before production: the owner must review the provider's data-retention terms, and a real
  secret manager must replace `EnvSecretStore` (which refuses to run outside local development).
