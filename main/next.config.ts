import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
