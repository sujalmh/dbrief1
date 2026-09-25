import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

/**
 * Single-page app: only the landing route is crawlable. Authenticated
 * chat state is client-side and intentionally absent from the sitemap.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${site.url}/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
