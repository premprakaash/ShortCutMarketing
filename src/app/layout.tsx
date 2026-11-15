import type { Metadata } from "next";
import Link from "next/link";
import Nav from "./nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShortCut Marketing",
  description: "Create AI video ads and run them on Meta, Google, TikTok, LinkedIn, Pinterest and Snapchat from one place.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app">
          <aside className="sidebar">
            <Link href="/" className="brand">
              {/* Replace public/logo.svg with your own logo file */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.svg" alt="" />
              <span>
                ShortCut
                <small>Marketing</small>
              </span>
            </Link>
            <Nav />
            <Link href="/create" className="btn primary cta">
              + New campaign
            </Link>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
