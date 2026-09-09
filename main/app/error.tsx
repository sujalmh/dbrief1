"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle, RotateCcw } from "lucide-react"

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error)
  }, [error])

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-carbon text-foreground p-6">
      <div className="flex flex-col items-center max-w-md text-center gap-6 p-8 rounded-2xl bg-muted/20 border border-muted/30 shadow-2xl">
        <div className="h-16 w-16 rounded-full bg-red-500/10 flex items-center justify-center mb-2">
          <AlertTriangle className="h-8 w-8 text-red-500" />
        </div>
        
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">System Failure</h2>
          <p className="text-sm text-muted-foreground">
            A critical error occurred in the visualization or chat interface.
          </p>
        </div>
        
        <div className="w-full text-left bg-black/40 p-4 rounded-lg overflow-auto max-h-48 border border-white/5">
          <p className="font-mono text-xs text-red-400 break-words">
            {error.message || "Unknown error occurred"}
          </p>
        </div>

        <Button 
          onClick={() => reset()}
          className="w-full font-bold uppercase tracking-wide mt-2"
          variant="default"
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Attempt Recovery
        </Button>
      </div>
    </div>
  )
}
