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
              d="M 80 32 C 138 20, 206 24, 240 53 C 256 66, 265 86, 270 110 C 253 92, 244 78, 227 65 C 200 44, 136 31, 80 32 Z"
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
              d="M 200 116 L 270 116 C 271 134, 270 152, 266 170 L 252 170 C 254 156, 249.5 141.5, 236 131.5 C 224 122.5, 209 119, 200 116 Z"
              fill="#0B0B0C"
            />
            <path
              d="M 220 65 L 222.4 74.1 L 231.5 76.5 L 222.4 78.9 L 220 88 L 217.6 78.9 L 208.5 76.5 L 217.6 74.1 Z"
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
        Your pit-wall engineer for every Grand Prix — telemetry, tyre
        strategy, timing &amp; regulations, answered with the data on screen.
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
