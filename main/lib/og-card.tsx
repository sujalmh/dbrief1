/**
 * Shared OG card markup for opengraph-image.tsx / twitter-image.tsx.
 * Pure JSX + inline styles only — must run in the edge runtime with no
 * external fonts, images, or Node APIs.
 */

export function OgCard() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "64px 72px",
        backgroundColor: "#0c0c0c",
        backgroundImage:
          "linear-gradient(45deg, #111 25%, transparent 25%, transparent 75%, #111 75%, #111), linear-gradient(45deg, #111 25%, transparent 25%, transparent 75%, #111 75%, #111)",
        backgroundSize: "16px 16px",
        backgroundPosition: "0 0, 8px 8px",
        color: "#ffffff",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "20px",
          marginBottom: "28px",
        }}
      >
        <div
          style={{
            width: "72px",
            height: "72px",
            borderRadius: "16px",
            backgroundColor: "#E10600",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "36px",
            fontWeight: 900,
          }}
        >
          D1
        </div>
        <div
          style={{
            fontSize: "26px",
            letterSpacing: "4px",
            color: "#a1a1aa",
            fontWeight: 700,
          }}
        >
          RACE ENGINEERING &amp; STRATEGY ANALYSIS
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "baseline",
          fontSize: "84px",
          fontWeight: 900,
          letterSpacing: "-3px",
          lineHeight: 1,
          marginBottom: "20px",
        }}
      >
        <div>DBRIEF</div>
        <div style={{ color: "#E10600" }}>1</div>
      </div>
      <div
        style={{
          fontSize: "30px",
          lineHeight: 1.35,
          color: "#d4d4d8",
          maxWidth: "960px",
        }}
      >
        Live timing, telemetry, tyre stints &amp; FIA regulations — clear F1
        strategy answers with interactive charts.
      </div>
      <div
        style={{
          marginTop: "32px",
          fontSize: "24px",
          color: "#71717a",
          letterSpacing: "1px",
        }}
      >
        dbrief1.xyz
      </div>
    </div>
  );
}
