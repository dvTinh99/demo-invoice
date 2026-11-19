import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Font Unicode cho PDF của Mock được đọc bằng fs lúc chạy — cần đưa vào bundle serverless (Vercel)
  outputFileTracingIncludes: {
    "/api/mock-viettel/**": ["./assets/fonts/**"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
