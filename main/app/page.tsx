"use client"

import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { MessageList } from "@/components/chat/message-list"
import { ChatInput } from "@/components/chat/chat-input"
import { SettingsModal } from "@/components/chat/settings-modal"
import { ErrorModal } from "@/components/ui/error-modal"
import { VisualizationPanel } from "@/components/visualization/visualization-panel"
import { useChatStore } from "@/lib/store"
import { useMediaQuery } from "@/lib/hooks/use-media-query"
import { useSession } from "@/lib/cf/session-context"
import { Loader2 } from "lucide-react"

export default function Home() {
  const { settings, visualizationWidth, isVisualizationCollapsed } = useChatStore()
  const { loading } = useSession()
  const isDesktop = useMediaQuery("(min-width: 768px)")

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

  return (
    <div className="flex h-screen w-full bg-background font-sans antialiased text-foreground overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />

        <main className="relative flex h-full w-full overflow-hidden bg-carbon">
          {/* Full width message area */}
          <div
            className="flex-1 overflow-y-auto w-full transition-[padding] duration-300 relative z-10"
            style={{ paddingRight: prValue }}
          >
            <MessageList />
          </div>

          {/* Floating Input Layer */}
          <div
            className="absolute bottom-6 left-0 w-full z-20 transition-[padding] duration-300 pointer-events-none"
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
