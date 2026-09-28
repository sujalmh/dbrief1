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
            width: "120px",
            height: "72px",
            borderRadius: "16px",
            backgroundColor: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "8px 10px",
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 320 180"
            width="100"
            height="56"
          >
            <path
              d="M 80 32 C 138 20, 208 24, 244 55 C 261 70, 271 94, 277 122.5 C 258 102, 247 81, 228 66 C 200 44, 136 31, 80 32 Z"
              fill="#0B0B0C"
            />
            <path
              d="M 6 74 C 70 72, 132 66.5, 167 67.5 C 184 68, 196 72.5, 206 82.5 C 160 80.5, 78 77, 6 74 Z"
              fill="#E30613"
            />
            <path
              d="M 48 101 C 104 99.5, 150 99, 173.5 107 C 190.5 113, 194.5 124, 207.5 134 C 218 142.5, 230 148.5, 241 153.5 C 225 150, 208 143, 196 133 C 183.5 123, 178.5 117, 159.5 111.5 C 130 104, 88 102, 48 101 Z"
              fill="#E30613"
            />
            <path
              d="M 199 109 L 263.5 112.5 C 266.5 129.5, 265.5 150, 260.5 170 L 247 170 C 249 156, 244.5 141.5, 232 131.5 C 221 122.5, 208.5 114.5, 199 109 Z"
              fill="#0B0B0C"
            />
            <path
              d="M 230 65 L 232.4 74.1 L 241.5 76.5 L 232.4 78.9 L 230 88 L 227.6 78.9 L 218.5 76.5 L 227.6 74.1 Z"
              fill="#E30613"
            />
          </svg>
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
