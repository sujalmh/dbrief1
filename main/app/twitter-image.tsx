import { ImageResponse } from "next/og";
import { OgCard } from "@/lib/og-card";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** X/Twitter large-summary-card cover (kept in sync with OG). */
export default function TwitterImage() {
  return new ImageResponse(<OgCard />, { ...size });
}
