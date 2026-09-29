import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
    title: "Privacy Policy — Dbrief1",
    description: "How Dbrief1 collects, uses, and retains your data.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="space-y-2">
            <h2 className="text-lg font-bold tracking-tight text-white">{title}</h2>
            <div className="space-y-2 text-sm leading-relaxed text-zinc-300">{children}</div>
        </section>
    );
}

export default function PrivacyPage() {
    // Own scroll container: the root layout locks body scroll for the
    // chat shell (see landing-page.tsx).
    return (
        <main className="flex h-dvh w-full justify-center overflow-y-auto overscroll-contain bg-carbon px-4 py-12 text-white">
            <article className="w-full max-w-3xl space-y-8">
                <header className="space-y-2">
                    <p className="text-xs font-mono uppercase tracking-widest text-f1-red">Dbrief1</p>
                    <h1 className="text-3xl font-bold tracking-tighter">Privacy Policy</h1>
                    <p className="text-xs text-zinc-500">Last updated: September 2026</p>
                </header>

                <Section title="What Dbrief1 is">
                    <p>
                        Dbrief1 is a free Formula 1 analysis assistant. You sign in with Google, ask
                        questions about races, telemetry, regulations, and strategy, and the app
                        stores your conversations so you can resume them on any device.
                    </p>
                </Section>

                <Section title="Data we collect">
                    <ul className="list-disc space-y-1 pl-5">
                        <li>
                            <strong className="text-white">Account data (via Google sign-in):</strong>{" "}
                            your email address, display name, and profile photo. We never see or
                            store your Google password.
                        </li>
                        <li>
                            <strong className="text-white">Your conversations:</strong> chat messages,
                            tool-call traces (which data sources were queried and their arguments),
                            charts and visualization payloads, research evidence, citations, token
                            usage, and session titles.
                        </li>
                        <li>
                            <strong className="text-white">Technical identifiers:</strong> a random
                            session cookie (<code className="font-mono text-xs">cf_uid</code>) that
                            identifies your browser, and a salted one-way hash of your IP address
                            used only for abuse prevention and usage quotas. Raw IP addresses are
                            never stored.
                        </li>
                        <li>
                            <strong className="text-white">Usage counters:</strong> daily tallies of
                            queries, deep-research runs, simulations, and token counts used to
                            enforce the free-tier limits.
                        </li>
                    </ul>
                </Section>

                <Section title="How your data is used">
                    <ul className="list-disc space-y-1 pl-5">
                        <li>To provide the service: answering questions, restoring chat history, and rendering charts.</li>
                        <li>
                            To operate safely within a free tier: enforcing daily usage limits and
                            preventing abuse (including limiting new accounts per network).
                        </li>
                        <li>To answer you, your messages are sent to the configured AI model provider.</li>
                    </ul>
                    <p>
                        We do not sell your data. We show no ads and run no third-party analytics
                        or tracking scripts.
                    </p>
                </Section>

                <Section title="Where your data lives">
                    <ul className="list-disc space-y-1 pl-5">
                        <li>App hosting: Vercel.</li>
                        <li>Conversations and account records: Cloudflare D1 database with large payloads in Cloudflare R2 object storage.</li>
                        <li>Identity verification: Google (OAuth 2.0).</li>
                        <li>Race data retrieval: our FastAPI backend, Qdrant (regulation search), Voyage AI (embeddings), and TinyFish (web search).</li>
                        <li>
                            AI answers: the managed model provider, or — if you enable Bring Your
                            Own Key — the endpoint and key you configure yourself.
                        </li>
                    </ul>
                </Section>

                <Section title="Retention">
                    <ul className="list-disc space-y-1 pl-5">
                        <li>Conversations are kept until you delete them (per message, per session, or via Clear Telemetry).</li>
                        <li>Usage and abuse-prevention counters are short-lived and pruned automatically after about a week.</li>
                        <li>Signing out clears your browser session; your stored history remains until you delete it.</li>
                    </ul>
                </Section>

                <Section title="Your controls">
                    <ul className="list-disc space-y-1 pl-5">
                        <li>Delete any message, session, or your full history at any time from the app.</li>
                        <li>Signing in with Google is required to use the chat; deleting your sessions removes your stored conversations.</li>
                        <li>Bring Your Own Key is optional — your key is stored in a secure httpOnly cookie, never in readable storage.</li>
                        <li>
                            <strong className="text-white">Sharing:</strong> you can create a
                            read-only link for any chat. Anyone with the link can read its
                            messages and sources without signing in — charts, usage stats, and
                            other internals are never shared. Revoking the link or deleting the
                            session disables it immediately.
                        </li>
                    </ul>
                </Section>

                <Section title="Contact">
                    <p>
                        For privacy questions, contact the operator at the support email listed on
                        the app&apos;s Google OAuth consent screen.
                    </p>
                </Section>

                <footer className="flex gap-4 border-t border-white/10 pt-4 text-xs text-zinc-500">
                    <Link href="/" className="hover:text-white">Home</Link>
                    <Link href="/terms" className="hover:text-white">Terms of Service</Link>
                </footer>
            </article>
        </main>
    );
}
