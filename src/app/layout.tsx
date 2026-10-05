import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "YouTube Following",
  description: "A chronological feed from the YouTube channels you choose.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="shell site-header__inner">
            <Link className="brand" href="/">
              YouTube Following
            </Link>
            <nav aria-label="Primary">
              <Link href="/">Feed</Link>
              <Link href="/following">Following</Link>
              <Link href="/account">Account</Link>
              <Link href="/demo">Demo</Link>
            </nav>
          </div>
        </header>
        <main className="shell page">{children}</main>
      </body>
    </html>
  );
}
