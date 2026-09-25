import { ImageResponse } from "next/og";
import { OgCard } from "@/lib/og-card";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Link-preview cover: iMessage / Slack / Discord / WhatsApp / X. */
export default function OpenGraphImage() {
  return new ImageResponse(<OgCard />, { ...size });
}
