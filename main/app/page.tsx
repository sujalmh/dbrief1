"use client"

import dynamic from "next/dynamic"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { MessageList } from "@/components/chat/message-list"
import { ChatInput } from "@/components/chat/chat-input"
import { useChatStore } from "@/lib/store"
import { useMediaQuery } from "@/lib/hooks/use-media-query"
import { useSession } from "@/lib/cf/session-context"
import { SignInPage } from "@/components/auth/signin-page"
import { Loader2 } from "lucide-react"
import { useEffect } from "react"

// Heavy, non-critical UI is code-split out of the initial bundle so
// first paint only downloads the chat shell:
// - VisualizationPanel pulls in recharts (~hundreds of KB) via
//   ChartDispatcher → intelligent-charts.
// - SettingsModal pulls in Radix Dialog + form controls.
// - ErrorModal pulls in framer-motion.
const VisualizationPanel = dynamic(
    () => import("@/components/visualization/visualization-panel").then((m) => m.VisualizationPanel),
    { ssr: false }
)
const SettingsModal = dynamic(
    () => import("@/components/chat/settings-modal").then((m) => m.SettingsModal),
    { ssr: false }
)
const ErrorModal = dynamic(
    () => import("@/components/ui/error-modal").then((m) => m.ErrorModal),
    { ssr: false }
)

const AUTH_ERRORS: Record<string, string> = {
  denied: "Google sign-in was cancelled before completing.",
  state: "Google sign-in expired or was tampered with — please try again.",
  verify: "Google sign-in could not be verified — please try again.",
  unconfigured: "Google sign-in is not set up on this deployment yet.",
};

function useAuthErrorBanner() {
  const setError = useChatStore((s) => s.setError);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Server redirects here as /?auth=error&reason=<code> on OAuth failure.
    if (params.get("auth") !== "error") return;
    const reason = params.get("reason") || "verify";
    setError(AUTH_ERRORS[reason] || AUTH_ERRORS.verify!);
    window.history.replaceState(null, "", window.location.pathname);
  }, [setError]);
}

export default function Home() {
  // Selector subscriptions (not a full-store spread) so streamed tokens
  // updating `messages` don't re-render the whole page shell.
  const settings = useChatStore((s) => s.settings)
  const visualizationWidth = useChatStore((s) => s.visualizationWidth)
  const isVisualizationCollapsed = useChatStore((s) => s.isVisualizationCollapsed)
  const { user, loading } = useSession()
  const isDesktop = useMediaQuery("(min-width: 768px)")
  useAuthErrorBanner()

  // Calculate dynamic padding based on visualization state - ONLY on Desktop
  const prValue = (isDesktop && settings.visualizeEnabled && !isVisualizationCollapsed)
    ? `${visualizationWidth}px`
    : "0px"

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-carbon text-white">
        <Loader2 className="h-8 w-8 animate-spin text-f1-red" />
      </div>
    )
  }

  // Signed-out visitors land on sign up/in first — the chat UI (and
  // its history, quotas, and usage) requires a Google-linked identity.
  if (!user?.google) {
    return <SignInPage />
  }

  return (
    <div className="flex h-dvh w-full bg-background font-sans antialiased text-foreground overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
        <Header />

        <main className="relative flex h-full w-full overflow-hidden bg-carbon">
          {/* Full width message area */}
          <div
            className="flex-1 overflow-y-auto w-full transition-[padding] duration-300 relative z-10 overscroll-contain"
            style={{ paddingRight: prValue }}
          >
            <MessageList />
          </div>

          {/* Floating Input Layer — clears the iPhone home bar */}
          <div
            className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-0 w-full z-20 transition-[padding] duration-300 pointer-events-none"
            style={{ paddingRight: prValue }}
          >
            <div className="mx-auto max-w-3xl px-4 pointer-events-auto">
              <ChatInput />
            </div>
          </div>

          {/* Visualization Panel (Fixed Right on Desktop, Overlay on Mobile) */}
          <VisualizationPanel />
        </main>
      </div>

      <SettingsModal />
      <ErrorModal />
    </div>
  );
}
