import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Faz o Next compilar o pacote @tele/shared (que e TypeScript puro).
  transpilePackages: ["@tele/shared"],
  // Cabecalho que impede o site de ser aberto dentro de um iframe alheio.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
