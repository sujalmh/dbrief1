"use client"

import { Header } from "@/components/layout/header"
import { MessageList } from "@/components/chat/message-list"
import { ChatInput } from "@/components/chat/chat-input"
import { SettingsModal } from "@/components/chat/settings-modal"
import { ErrorModal } from "@/components/ui/error-modal"
import { VisualizationPanel } from "@/components/visualization/visualization-panel"
import { useChatStore } from "@/lib/store"

export default function Home() {
  const { settings, visualizationWidth, isVisualizationCollapsed } = useChatStore()

  // Calculate dynamic padding based on visualization state
  const prValue = (settings.visualizeEnabled && !isVisualizationCollapsed) ? `${visualizationWidth}px` : "0px"

  return (
    <div className="flex h-screen flex-col bg-background font-sans antialiased text-foreground overflow-hidden">
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

        {/* Visualization Panel (Fixed Right) */}
        <VisualizationPanel />
      </main>

      <SettingsModal />
      <ErrorModal />
    </div>
  );
}
