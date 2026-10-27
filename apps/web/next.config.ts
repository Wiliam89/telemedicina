import type { NextConfig } from "next";

/**
 * Cabecalhos de seguranca de TODAS as paginas (ADR-0020).
 *
 * A Content-Security-Policy aqui e a parte que nao quebra nada: proibe o
 * site de ser aberto dentro de iframe alheio (clickjacking), plugins e
 * formularios que enviam para outro dominio. Camera e microfone ficam
 * liberados para a sala de video (o iframe do provedor pede com allow=).
 */
const SEGURANCA = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "Permissions-Policy", value: "geolocation=(), payment=(), usb=(), interest-cohort=()" },
];

const nextConfig: NextConfig = {
  // Faz o Next compilar o pacote @tele/shared (que e TypeScript puro).
  transpilePackages: ["@tele/shared"],
  poweredByHeader: false,
  // Permite compilar para outra pasta sem atrapalhar o `next dev` aberto.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async headers() {
    return [{ source: "/(.*)", headers: SEGURANCA }];
  },
};

export default nextConfig;
