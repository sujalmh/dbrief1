"use client"

import { Header } from "@/components/layout/header"
import { MessageList } from "@/components/chat/message-list"
import { ChatInput } from "@/components/chat/chat-input"
import { SettingsModal } from "@/components/chat/settings-modal"
import { VisualizationPanel } from "@/components/visualization/visualization-panel"
import { useChatStore } from "@/lib/store"

export default function Home() {
  const { settings, visualizationWidth, isVisualizationCollapsed } = useChatStore()

  // Calculate dynamic padding based on visualization state
  const prValue = (settings.visualizeEnabled && !isVisualizationCollapsed) ? `${visualizationWidth}px` : "0px"

  return (
    <div className="flex h-screen flex-col bg-background font-sans antialiased text-foreground overflow-hidden">
      <Header />

      <main className="w-full max-w-screen-2xl mx-auto flex flex-1 flex-col overflow-hidden relative">
        <div
          className="flex-1 w-full relative min-h-0 transition-[padding] duration-300"
          style={{ paddingRight: prValue }}
        >
          <MessageList />
        </div>

        <div
          className="w-full px-4 py-4 z-20 transition-[padding] duration-300"
          style={{ paddingRight: prValue }}
        >
          <div className="mx-auto max-w-3xl">
            <ChatInput />
          </div>
        </div>

        {/* Visualization Panel */}
        <VisualizationPanel />
      </main>

      <SettingsModal />
    </div>
  );
}
