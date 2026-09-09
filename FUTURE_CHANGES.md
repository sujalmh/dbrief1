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

## Pending / Known Gaps

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
- [ ] **Untracked, not owned by this work:** `test.py` (repo root),
  `main/scripts/benchmark-go-latency.mjs`. Left untouched — commit or remove
  separately if still needed.
