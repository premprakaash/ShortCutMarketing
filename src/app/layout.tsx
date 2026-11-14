import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShortCut Marketing",
  description: "Create and run video ads on Meta, Google and more from one place.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link href="/" className="brand">
              ShortCut <span>Marketing</span>
            </Link>
            <nav className="nav">
              <Link href="/">Dashboard</Link>
              <Link href="/boost">Boost a video</Link>
              <Link href="/connections">Ad accounts</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
