import type { MetadataRoute } from "next";

/** Internal tool -- crawlers are told to stay out entirely. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
