import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { ModeBadge } from "@/components/ModeBadge";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin", "vietnamese"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "S-Invoice 2.0 Demo",
  description: "POC tích hợp Hóa đơn điện tử Viettel S-Invoice 2.0",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-semibold text-slate-900">
              S-Invoice 2.0 <span className="text-slate-400 font-normal">Integration Demo</span>
            </Link>
            <nav className="flex gap-4 text-sm text-slate-600">
              <Link href="/" className="hover:text-slate-900">Hóa đơn</Link>
              <Link href="/invoices/new" className="hover:text-slate-900">Tạo hóa đơn</Link>
              <Link href="/logs" className="hover:text-slate-900">Log kỹ thuật</Link>
            </nav>
            <div className="ml-auto">
              <ModeBadge />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
