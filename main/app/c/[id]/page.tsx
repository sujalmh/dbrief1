import { ChatShell } from "@/components/chat/chat-shell";

/**
 * Per-session URL (`/c/<id>`), ChatGPT-style.
 * ==========================================
 * Server component: resolves the id from the URL and hands it to the
 * shared client shell, which hydrates that session from the cloud.
 * All movement between sessions is client-side navigation — the URL
 * changes, the page never reloads.
 */
export default async function ChatSessionPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    return <ChatShell routeSessionId={id} />;
}
