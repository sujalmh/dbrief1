# Future Changes

Tracking file for pending / planned work. Checked items are synced to `origin/main`.

## Synced

- [x] Parallel pre-execution LLM calls (`main/app/api/chat/route.ts`,
      `main/lib/research/manager.ts`): intent + planner + session metadata
  overlap; planner + responder init overlap in deep mode; classify + intent
  overlap in `ResearchManager`.
- [x] RAG sources are LLM-picked, never raw top-N:
  `lib/agents/regulationRetriever.ts` (rerank `relevance_score` carry,
  `MIN_RELEVANCE_SCORE` floor, `source_url` end-to-end),
  `lib/utils/sources.ts` (structured-output `pickUsedSources`),
  route emits `citations` only for picked docs, deep mode yields citations
  for actually-cited evidence, UI renders clickable title links, sources
  persisted to Firestore and restored on session load.
- [x] Streamline LLM config, model settings UI, and research pipeline
  (`e1168f2`): removed central config/reference-data/text modules, reworked
  providers/planner/settings modal/usage footer, added OpenRouter models
  route + add-models dialog + Go latency benchmark.

## Pending / Known Gaps

- [x] **Persist full tool-call trace with the assistant message:** every `Message` is now saved fully — steps + args + status /
  error, full `visualizationData`, deep-mode iterations (with task args) /
  evidence (+ `data` when small) / reflections / confidence / chartSpecs,
  citations, usage, degraded warnings, reasoning — via
  `main/lib/cf/serialization.ts` (pure build/parse/truncate) +
  `main/lib/cf/store.ts` (D1 inline + R2 overflow for >200KB fields,
  truncation fallback, stable `m_*` IDs). Session-level UI
  (`visualizationData`, `graphHistory`, `activeMessageId`) persists to the
  session row context (R2 offload when large). Reload (`sidebar
  handleSelectSession`) hydrates blobs and restores panel/graphs/active
  message. Message edits (`PATCH`) and deletes (`DELETE`, incl. retry,
  per-message trash, Clear Telemetry, session delete with blob cleanup)
  all sync to the cloud. Tests: `__tests__/unit/session-serialization.test.ts`.
- [x] **Firebase removed, Cloudflare storage live (verified end-to-end):**
  D1 `f1-sessions` (`c5acda92…`, tables `users/sessions/messages/blobs`)
  + R2 bucket `f1-ai` provisioned via MCP. Next.js talks to D1/R2 REST
  through `/api/cf/*` routes (`health/me/signout/sessions/.../messages/
/context`); browser keeps only the `cf_uid` cookie (server-issued,
  auto-provisioned — Google login UI deleted). Chat route uses the cookie
  instead of `firebaseToken`. `lib/firebase/*`, `firebase.json`,
  `firestore.*`, `storage.rules`, `login-page/modal`, `firebase*` npm deps
  all removed. Live-verified with `CF_API_TOKEN` set: health `ok:true`
  (d1+r2), 14-step CRUD round-trip green (session/message/context/edit/
  delete), 446KB telemetry offloaded to R2 + hydrated to 15000 points,
  session delete cascades to D1 rows + R2 objects (D1 `0/0/0`, R2 404s).
  Vercel: `CF_API_TOKEN` (+ IDs) set Encrypted for Production + Development;
  stale `NEXT_PUBLIC_FIREBASE_*` removed. Hardened: `Secure` cookies in
  prod, per-caller rate limits on `/api/cf/*` (180 writes/600 reads per
  min), 12MB body caps (413), LIKE-escaped blob cleanup, ownership checks
  on every query. NOTE: redeploy (push to main) for the new env vars to
   take effect; Preview envs still need the 4 vars via dashboard (Vercel CLI
   quirk) or those deploys run local-only by design.
- [x] **Free-tier quotas live:** dual-ledger enforcement
  (account `cf_uid` + salted IP hash, both must pass; IP ceilings ≈ 2× at
  40 queries/6 deep/6 sims per day) in `main/lib/cf/quotas.ts` + D1 tables
  `quota_daily/quota_ip_daily/global_spend_daily/managed_keys` (+ `users`
  gains `ip_hash/created_day/tier`). Pre-flight 429s with BYOK-hint copy;
  post-stream dual accounting (tokens + OpenRouter cost or price-table
  estimate); $5/day global managed breaker; sim iteration clamps per tier
  (2000/5000) + sim metering from executed tool results; 10-provisions/
  IP/day anti-farming in `/api/cf/me`. Fail-open on D1 errors,
  `QUOTAS_ENABLED=false` kill-switch, `ADMIN_UIDS` bypass. Live-verified
  deny + allow paths. `IP_HASH_SALT`/`QUOTAS_ENABLED` set on Vercel
  (prod+dev) and `.env.local`; full reference in `env.example`. Tests:
  `__tests__/unit/quotas.test.ts` (14 green). Deployed to production
  2026-09-17 via `vercel deploy --prod` (all working-tree changes incl. CF
  migration + quotas + indicator + sim fixes; `.vercelignore` added to keep
  uploads small); prod `/api/cf/health` → `ok:true d1:true r2:true`.
  Tightened caps: free 20 chats/3 sims, IP 2× (40/6), BYOK 100/10/20.
- [x] **Direct Google OAuth, no Firebase:** optional "Sign in
  with Google" in the sidebar footer (hidden until configured; app stays
  passwordless-first). Plain OAuth 2.0 code flow in `main/lib/auth/
  google.ts` — single-use state cookie + nonce, server-side code exchange,
  RS256 ID-token verification against Google JWKS (iss/aud/exp/nonce/
  verified-email), zero new npm deps. Callback links the anonymous
  identity to a deterministic `g_<sub>` D1 user and migrates its sessions
  (never merges two linked accounts; quota ledgers stay behind by design).
  D1 `users` gains `google_sub/email/avatar_url` (+ unique index).
  `/api/cf/me` exposes link state; failures surface via the existing error
  modal (`/?auth=error`). Tests: `__tests__/unit/google-auth.test.ts`
  (10 green, incl. tampered-payload/wrong-aud/expired/nonce rejection and
  mocked-D1 link/migrate).
  Done 2026-09-17: Vercel vars set (prod+dev, sensitive),
  redeployed, `/api/auth/google` lands on Google's real account chooser
  (correct client_id/redirect URI/scopes — no mismatch errors), callback
  rejects bad state to `/?auth=error`.
- [x] **Sidebar usage indicator:** subtle status dot on the
  profile avatar (green→amber→red by worst utilization); hover reveals a
  compact card — Chats / Deep / Sims / Tokens-out used-vs-cap, shared-
  network note only when the IP ledger binds, tier label, UTC reset
  countdown, managed-pause notice. Data from new `GET /api/cf/quota`
  (`getQuotaState` in quotas.ts); hidden entirely when cloud sync is off;
  refreshes after each completed turn. Tests:
  `__tests__/unit/usage-indicator.test.ts` (7 green).

- [ ] **Firestore rules gap (pre-existing, blocks history writes if enforced):**
  `main/firestore.rules` requires `userId` on message docs, but the client
  never writes it (`addMessageToSession` sends `{role, content, ...}` only).
  Either write `userId` on messages or relax the rule to check the parent
  session's owner.
- [ ] **Vitest can't run on Node 18:** vitest 4 requires Node 20+.
  Upgrade the runtime or pin vitest. Unit tests added for this work
  (`__tests__/unit/sources.test.ts`, rerank floor / `source_url` cases)
  still need a green run.
- [ ] **Pick latency:** `pickUsedSources` runs between the last answer token
  and `done` (bounded by the 20s intent timeout, typically 1–3s). Consider a
  tighter dedicated timeout if the spinner tail becomes noticeable.
- [ ] **Pick context window:** the pick call sees the first 6000 chars of the
  answer. Revisit if long answers cite sources only in the tail.
- [ ] **Rerank floor calibration:** `MIN_RELEVANCE_SCORE = 0.2` is a
  conservative guess for Voyage rerank-3. Revisit with production score
  distributions; the keep-best fallback prevents empty results.
- [ ] **`visualization` event still ships full doc content** to the client for
  charts — only the Sources UI is gated. Fine for now, note if payloads grow.
- [ ] **Untracked, not owned by this work:** `test.py` (repo root) contains a
  hardcoded live API key — must never be committed as-is. Move the key to
  an env var and rotate it, then commit or remove the file.
