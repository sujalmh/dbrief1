import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

/** Web app manifest: installability, task-switcher identity, share sheets. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.title,
    short_name: site.shortName,
    description: site.description,
    start_url: "/",
    display: "standalone",
    background_color: site.backgroundColor,
    theme_color: site.themeColorDark,
    icons: [
      {
        src: "/logo.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/f1-logo-small.png",
        sizes: "800x800",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
    categories: ["sports", "utilities"],
  };
}
