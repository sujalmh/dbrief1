import type { Metadata } from "next";
import Link from "next/link";
import { F1_REQUIRED_NOTICE, F1_EXTENDED_NOTICE } from "@/components/legal/f1-disclaimer";

export const metadata: Metadata = {
    title: "Terms of Service — Dbrief1",
    description: "The terms governing use of Dbrief1.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="space-y-2">
            <h2 className="text-lg font-bold tracking-tight text-white">{title}</h2>
            <div className="space-y-2 text-sm leading-relaxed text-zinc-300">{children}</div>
        </section>
    );
}

export default function TermsPage() {
    // Own scroll container: the root layout locks body scroll for the
    // chat shell (see landing-page.tsx).
    return (
        <main className="flex h-dvh w-full justify-center overflow-y-auto overscroll-contain bg-carbon px-4 py-12 text-white">
            <article className="w-full max-w-3xl space-y-8">
                <header className="space-y-2">
                    <p className="text-xs font-mono uppercase tracking-widest text-f1-red">Dbrief1</p>
                    <h1 className="text-3xl font-bold tracking-tighter">Terms of Service</h1>
                    <p className="text-xs text-zinc-500">Last updated: September 2026</p>
                </header>

                <Section title="The service">
                    <p>
                        Dbrief1 is a free Formula 1 analysis assistant. Sign-in with Google is
                        required to use the chat. Use is subject to daily free-tier limits on
                        chats, deep-research runs, simulations, and tokens, shared per account
                        and per network.
                    </p>
                </Section>

                <Section title="AI-generated answers">
                    <p>
                        Answers are produced by AI models grounded in retrieved race data,
                        regulations, and web sources — but they can be incomplete or wrong.
                        Always verify time-critical or consequential information against
                        official Formula 1 sources. Dbrief1 is not affiliated with Formula 1,
                        the FIA, or any team.
                    </p>
                </Section>

                <Section title="Acceptable use">
                    <ul className="list-disc space-y-1 pl-5">
                        <li>Do not attempt to bypass usage limits (for example, farming accounts or rotating networks to evade quotas).</li>
                        <li>Do not attack, probe, or disrupt the service, its APIs, or other users&apos; data.</li>
                        <li>Do not use the service for unlawful purposes or to generate unlawful content.</li>
                        <li>Accounts or networks engaged in abuse may be rate-limited, suspended, or removed.</li>
                    </ul>
                </Section>

                <Section title="Your content">
                    <p>
                        You retain ownership of the messages you send. You grant Dbrief1 a
                        limited license to store and process them solely to operate the
                        service (answering, history sync, charts, and abuse prevention). You
                        can delete your messages and sessions at any time from within the app.
                    </p>
                </Section>

                <Section title="Bring Your Own Key">
                    <p>
                        If you supply your own model endpoint and API key, you are responsible
                        for that third-party service and its terms, costs, and data handling.
                        Your key is kept in a secure httpOnly cookie and is never exposed to
                        other users.
                    </p>
                </Section>

                <Section title="Availability and warranty">
                    <p>
                        The service is provided free of charge, &quot;as is&quot;, without
                        warranties of any kind. Availability, response quality, and usage
                        limits may change at any time as the service evolves toward a paid
                        tier.
                    </p>
                </Section>

                <Section title="Formula 1 trademarks">
                    <p>{F1_REQUIRED_NOTICE}</p>
                    <p>{F1_EXTENDED_NOTICE}</p>
                </Section>

                <Section title="Changes">
                    <p>
                        These terms may be updated as features change; continued use of the
                        service constitutes acceptance of the current version.
                    </p>
                </Section>

                <footer className="flex gap-4 border-t border-white/10 pt-4 text-xs text-zinc-500">
                    <Link href="/" className="hover:text-white">Home</Link>
                    <Link href="/privacy" className="hover:text-white">Privacy Policy</Link>
                </footer>
            </article>
        </main>
    );
}
