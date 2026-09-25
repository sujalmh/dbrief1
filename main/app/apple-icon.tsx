import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Apple touch icon (180x180) — red tile with D1 monogram. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#E10600",
          borderRadius: "40px",
          color: "#ffffff",
          fontSize: "84px",
          fontWeight: 900,
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        D1
      </div>
    ),
    { ...size },
  );
}
