import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  compress: true,
  // Dev only: Next 16 blocks /_next/* requests whose Host isn't localhost,
  // which breaks the app when it's opened from another device. These are the
  // hosts this machine is reachable on over the tailnet (Tailscale serve).
  allowedDevOrigins: ["laptop-p1vsp5h2.tail95c97a.ts.net", "100.82.117.9"],
  images: {
    formats: ["image/avif", "image/webp"],
  },
  // Turn barrel imports (lucide-react's hundreds of icons, recharts,
  // framer-motion) into per-module imports so the initial client
  // bundle only ships what's actually rendered on first paint.
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "framer-motion",
      "react-markdown",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-tooltip",
    ],
  },
  async headers() {
    return [
      {
        // Security + referrer posture for every route (link previews,
        // OAuth redirects, and crawlers included). No CSP here: a strict
        // policy risks breaking Google OAuth / fonts without per-route
        // tuning — add one only with a tested allowlist.
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
