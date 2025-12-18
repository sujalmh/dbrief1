"use client"

export function RadioWave() {
    return (
        <div className="flex items-center gap-1 h-4">
            <div className="w-1 h-2 bg-[var(--f1-red)] animate-[wave_1s_ease-in-out_infinite]" style={{ animationDelay: '0s' }}></div>
            <div className="w-1 h-3 bg-[var(--f1-red)] animate-[wave_1s_ease-in-out_infinite]" style={{ animationDelay: '0.1s' }}></div>
            <div className="w-1 h-4 bg-[var(--f1-red)] animate-[wave_1s_ease-in-out_infinite]" style={{ animationDelay: '0.2s' }}></div>
            <div className="w-1 h-2 bg-[var(--f1-red)] animate-[wave_1s_ease-in-out_infinite]" style={{ animationDelay: '0.3s' }}></div>
            <div className="w-1 h-3 bg-[var(--f1-red)] animate-[wave_1s_ease-in-out_infinite]" style={{ animationDelay: '0.4s' }}></div>
        </div>
    )
}
