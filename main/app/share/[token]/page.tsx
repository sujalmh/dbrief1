import { ShareView } from "@/components/share/share-view";

/**
 * Public shared-chat page (`/share/<token>`).
 * ==========================================
 * No sign-in gate here on purpose — anyone holding the link can read.
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    return <ShareView token={token} />;
}
