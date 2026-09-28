"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

export function Reveal({
    children,
    delay = 0,
    y = 24,
    className,
}: {
    children: ReactNode;
    delay?: number;
    y?: number;
    className?: string;
}) {
    const reduce = useReducedMotion();
    if (reduce) return <div className={className}>{children}</div>;
    return (
        <motion.div
            className={className}
            initial={{ opacity: 0, y }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-64px" }}
            transition={{ duration: 0.7, delay, ease: EASE }}
        >
            {children}
        </motion.div>
    );
}

export function Float({
    children,
    className,
    style,
    duration = 6,
    offset = 8,
    delay = 0,
}: {
    children: ReactNode;
    className?: string;
    style?: React.CSSProperties;
    duration?: number;
    offset?: number;
    delay?: number;
}) {
    const reduce = useReducedMotion();
    if (reduce)
        return (
            <div className={className} style={style}>
                {children}
            </div>
        );
    return (
        <motion.div
            className={className}
            style={style}
            animate={{ y: [0, -offset, 0] }}
            transition={{ duration, delay, repeat: Infinity, ease: "easeInOut" }}
        >
            {children}
        </motion.div>
    );
}
