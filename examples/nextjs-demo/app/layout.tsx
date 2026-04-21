import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lookout — AI-assisted QA for web apps",
  description:
    "Lookout Next.js demo: a realistic multi-page SaaS surface used by the Lookout crawler, evals, and public showcase.",
  icons: {
    icon: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='%236366f1'/><stop offset='50%' stop-color='%23a855f7'/><stop offset='100%' stop-color='%2322d3ee'/></linearGradient></defs><rect width='32' height='32' rx='8' fill='url(%23g)'/><circle cx='16' cy='16' r='6' fill='none' stroke='white' stroke-width='2.5'/></svg>",
  },
};

export const viewport: Viewport = {
  themeColor: "#07080d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
