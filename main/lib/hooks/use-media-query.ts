import { useCallback, useSyncExternalStore } from "react"

export function useMediaQuery(query: string): boolean {
    const subscribe = useCallback(
        (onChange: () => void) => {
            const media = window.matchMedia(query)
            media.addEventListener("change", onChange)
            return () => media.removeEventListener("change", onChange)
        },
        [query]
    )

    const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])

    // `false` for SSR (no window on the server)
    return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
