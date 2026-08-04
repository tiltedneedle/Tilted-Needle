import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // The app embeds other sites (YouTube/TikTok players) but is
          // never itself embedded -- kiosk mode included, which runs as a
          // normal top-level tab on the shared device.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Nothing in the app uses these device APIs (verified: no
          // getUserMedia/geolocation callers, kiosk is PIN-only).
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
