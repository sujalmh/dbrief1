/**
 * Benchmark: muse-spark-1.3-contributor (regular, NOT free) via OpenCode Go
 * Docs: https://opencode.ai/docs/go#endpoints
 *
 * Mirrors the project's own JS (main/lib/llm.ts):
 *   LangChain path = createGoModel() verbatim:
 *     new ChatOpenAI({ model, apiKey, temperature, maxTokens,
 *       useResponsesApi: true,
 *       configuration: { baseURL: GO_BASE_URL, defaultHeaders: buildOpenCodeHeaders(sessionId) } })
 *   Direct path = normal fetch POST to the same endpoint with the SAME
 *     headers/body/session, no LangChain wrapper.
 *
 * Run from main/:
 *   npm i  # once (@langchain/openai, @langchain/core, dotenv already in package.json)
 *   node scripts/benchmark-go-latency.mjs --trials 3 --prompt "Say hi in 3 words."
 *
 * Key loading mirrors the app: Settings key > OPENCODE_GO_API_KEY env.
 * .env at repo root (../../.env) is loaded, plus .env.local.
 */
import { config as loadDotenv } from "dotenv";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo-root .env (has OPENCODE_GO_API_KEY) + main/.env.local fallback — same as app
loadDotenv({ path: path.resolve(__dirname, "../../.env") });
loadDotenv({ path: path.resolve(__dirname, "../.env.local") });

// ---- Mirrored from main/lib/llm.ts (do not diverge) ----
const MODEL = "muse-spark-1.3-contributor";
const GO_BASE_URL = "https://opencode.ai/zen/go/v1";
const RESPONSES_URL = `${GO_BASE_URL}/responses`;
const OPENCODE_USER_AGENT = "dbrief1/1.0";
const OPENCODE_SESSION_HEADER = "x-opencode-session";

function buildOpenCodeHeaders(sessionId) {
  const headers = { "User-Agent": OPENCODE_USER_AGENT };
  if (sessionId) headers[OPENCODE_SESSION_HEADER] = sessionId;
  return headers;
}

function buildPayload(prompt) {
  // Mirror LangChain defaults below: temperature 0.7, 1024 output budget.
  // (Responses API name is max_output_tokens; 256 starves reasoning models —
  //  budget is eaten by reasoning, leaving empty visible text.)
  return { model: MODEL, input: prompt, stream: false, temperature: 0.7, max_output_tokens: 1024 };
}

function chatContentToText(content) {
  // Mirrored from main/lib/llm.ts chatContentToText()
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object") {
          const text = block.text;
          if (typeof text === "string") return text;
        }
        return "";
      })
      .join("");
  }
  return JSON.stringify(content);
}

function parseResponsesJson(data) {
  let text = data?.output_text ?? "";
  if (!text) {
    const parts = [];
    for (const item of data?.output ?? [])
      for (const c of item?.content ?? [])
        if (c?.type === "output_text" || c?.type === "text") parts.push(c.text ?? "");
    text = parts.join("");
  }
  return text;
}
// ---- end mirrored block ----

const apiKey = process.env.OPENCODE_GO_API_KEY;
if (!apiKey) {
  console.error("Missing OPENCODE_GO_API_KEY (repo-root .env or env).");
  process.exit(1);
}

const args = process.argv.slice(2);
const trials = Number(args[args.indexOf("--trials") + 1] ?? 3);
const prompt = args[args.indexOf("--prompt") + 1] ?? "Say hi in 3 words.";
const sessionId = `bench-${randomUUID()}`;

// LangChain client init ONCE (mirrors getChatModel('go') with responsesApi=true).
// Dynamic import keeps parity with lib/llm.ts (which lazy-imports to avoid bundling issues).
const { ChatOpenAI } = await import("@langchain/openai");
const { HumanMessage } = await import("@langchain/core/messages");

const lcModel = new ChatOpenAI({
  model: MODEL,
  apiKey,
  temperature: 0.7,
  maxTokens: 1024,
  useResponsesApi: true, // CRITICAL: Go Muse is Responses-only (/chat/completions -> 500)
  configuration: {
    baseURL: GO_BASE_URL,
    defaultHeaders: buildOpenCodeHeaders(sessionId),
  },
});

async function callDirectFetch(p) {
  const t0 = performance.now();
  const res = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...buildOpenCodeHeaders(sessionId),
    },
    body: JSON.stringify(buildPayload(p)),
  });
  const dt = performance.now() - t0;
  if (!res.ok) throw new Error(`Direct fetch HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = parseResponsesJson(await res.json());
  return { ms: dt, chars: text.length, preview: text.slice(0, 80) };
}

async function callLangChain(p) {
  // Extra work vs direct (the overhead under test): HumanMessage validation
  // -> ChatOpenAI conversion -> Runnable tracing/callbacks -> same POST -> AIMessage parse.
  const t0 = performance.now();
  const msg = await lcModel.invoke([new HumanMessage(p)]);
  const dt = performance.now() - t0;
  const content = chatContentToText(msg.content ?? msg.text ?? "");
  return { ms: dt, chars: content.length, preview: content.slice(0, 80) };
}

async function bench(name, fn) {
  console.log(`${name}:`);
  try {
    await fn(prompt); // warmup excluded (TLS / connection / lazy init)
  } catch (e) {
    console.log(`  [warmup failed] ${e.message}`);
  }
  const times = [];
  let errors = 0;
  for (let i = 0; i < trials; i++) {
    try {
      const { ms, chars, preview } = await fn(prompt);
      times.push(ms);
      console.log(`  trial ${i + 1}/${trials}: ${(ms / 1000).toFixed(3)}s (${chars} chars) "${(preview ?? "").replace(/\n/g, " ")}"`);
    } catch (e) {
      errors++;
      console.log(`  trial ${i + 1}/${trials}: ERROR ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { times, errors };
}

function stats(times) {
  if (!times.length) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const stdev =
    times.length > 1
      ? Math.sqrt(times.reduce((a, b) => a + (b - mean) ** 2, 0) / (times.length - 1))
      : 0;
  return { n: times.length, min: Math.min(...times), mean, median, max: Math.max(...times), stdev };
}

console.log(`Model: ${MODEL} | Base: ${GO_BASE_URL} | trials=${trials}`);
console.log(`Prompt: "${prompt}"\n`);

const results = {};
for (const [name, fn] of [
  ["A) Direct fetch (normal API call)", callDirectFetch],
  ["B) LangChain (project ChatOpenAI)", callLangChain],
]) {
  const { times, errors } = await bench(name, fn);
  const s = stats(times);
  results[name] = { ...s, errors };
  if (s) console.log(`  -> min ${(s.min / 1000).toFixed(3)}s | mean ${(s.mean / 1000).toFixed(3)}s | median ${(s.median / 1000).toFixed(3)}s | max ${(s.max / 1000).toFixed(3)}s\n`);
}

console.log("\n## Result table (seconds, lower is better)\n");
console.log("| Method | n | min | mean | median | max | stdev | errors |");
console.log("|---|---|---|---|---|---|---|---|");
for (const [name, r] of Object.entries(results)) {
  if (!r || !r.n) console.log(`| ${name} | 0 | - | - | - | - | - | ${r?.errors ?? "?"} |`);
  else
    console.log(
      `| ${name} | ${r.n} | ${(r.min / 1000).toFixed(3)} | ${(r.mean / 1000).toFixed(3)} | ${(r.median / 1000).toFixed(3)} | ${(r.max / 1000).toFixed(3)} | ${(r.stdev / 1000).toFixed(3)} | ${r.errors} |`
    );
}
const a = results["A) Direct fetch (normal API call)"];
const b = results["B) LangChain (project ChatOpenAI)"];
if (a?.median && b?.median)
  console.log(
    `\nLangChain overhead vs Direct (median): +${(b.median - a.median).toFixed(0)} ms (${((b.median / a.median - 1) * 100).toFixed(1)}%)`
  );
