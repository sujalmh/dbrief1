"use client"

import * as React from "react"
import { AlertTriangle, X } from "lucide-react"
import { useChatStore } from "@/lib/store"
import { AnimatePresence, motion } from "framer-motion"

export function ErrorModal() {
    const error = useChatStore((s) => s.error)
    const setError = useChatStore((s) => s.setError)
    
    if (!error) return null

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                onClick={() => setError(null)}
            >
                <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    className="relative w-full max-w-md overflow-hidden rounded-xl bg-[#151515] border border-red-600 shadow-2xl"
                >
                    {/* Header Strip */}
                    <div className="h-1 w-full bg-red-600" />
                    
                    <div className="p-6">
                        <div className="flex items-start gap-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-600/10 text-red-600">
                                <AlertTriangle className="h-6 w-6" />
                            </div>
                            
                            <div className="flex-1 space-y-2">
                                <h3 className="text-lg font-bold uppercase tracking-wider text-white">
                                    System Malfunction
                                </h3>
                                
                                <div className="text-sm text-gray-400 leading-relaxed font-mono border-l-2 border-red-600/30 pl-3">
                                    {error}
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end">
                            <button
                                onClick={() => setError(null)}
                                className="group relative flex items-center justify-center overflow-hidden rounded bg-red-600 px-6 py-2 text-xs font-bold uppercase tracking-widest text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
                            >
                                <span className="relative z-10">Acknowledge</span>
                                <div className="absolute inset-0 z-0 bg-white/20 opacity-0 transition-opacity group-hover:opacity-100" />
                            </button>
                        </div>
                    </div>
                    
                    {/* Close Button */}
                    <button 
                        onClick={() => setError(null)}
                        className="absolute right-4 top-4 text-gray-500 hover:text-white transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    )
}
