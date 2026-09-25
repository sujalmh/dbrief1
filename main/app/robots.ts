import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

/**
 * Crawlers may index the public landing page. Authenticated surfaces —
 * API routes, OAuth callbacks, and server-action state — must not be
 * indexed or have link equity pushed into them.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/_next/", "/static/"],
      },
      {
        userAgent: "*",
        allow: ["/opengraph-image", "/twitter-image", "/icon.svg", "/apple-icon"],
      },
    ],
    sitemap: `${site.url}/sitemap.xml`,
  };
}
