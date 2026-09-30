import { cn } from "@/lib/utils";

/**
 * F1 trademark disclaimer.
 * ========================
 * Wording follows Formula 1's own guideline for unofficial fan sites
 * (formula1.com/en/information/guidelines): unofficial projects must
 * state they are not associated with the Formula 1 companies and must
 * attribute the F1 marks to Formula One Licensing B.V. The sentence
 * below is their required wording, kept verbatim:
 *
 *   "This website is unofficial and is not associated in any way with
 *   the Formula 1 companies. F1, FORMULA ONE, FORMULA 1, FIA FORMULA
 *   ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade
 *   marks of Formula One Licensing B.V."
 *
 * The extended paragraph adds what fan-law best practice asks for:
 * no FIA/team/driver affiliation, nominative (descriptive) use only,
 * no ownership claimed, and a pointer to formula1.com.
 */

export const F1_REQUIRED_NOTICE =
    "This website is unofficial and is not associated in any way with the Formula 1 companies. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One Licensing B.V.";

export const F1_EXTENDED_NOTICE =
    "Dbrief1 is an independent, unofficial fan project. It is not affiliated with, endorsed by, or sponsored by Formula 1, Formula One Licensing B.V., Formula One Management, the FIA, or any team, driver, circuit, or sponsor. Team, driver, circuit, and Grand Prix names are used descriptively to identify the sport discussed. Official Formula 1 information can be found at formula1.com.";

export function F1Disclaimer({
    variant = "short",
    className,
}: {
    /** short: one line for footers · full: both paragraphs for legal surfaces */
    variant?: "short" | "full";
    className?: string;
}) {
    if (variant === "full") {
        return (
            <div className={cn("space-y-2", className)}>
                <p>{F1_REQUIRED_NOTICE}</p>
                <p>{F1_EXTENDED_NOTICE}</p>
            </div>
        );
    }
    return (
        <p className={cn("text-[10px] leading-snug text-muted-foreground/70", className)}>
            Unofficial fan project — not affiliated with Formula 1. F1 marks belong to
            Formula One Licensing B.V.{" "}
            <a href="/terms" className="underline underline-offset-2 hover:text-foreground">
                Terms
            </a>
        </p>
    );
}
