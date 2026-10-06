import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Safe Online Exam Reader",
  description: "Assessment PDFs with cached speech and timed access.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="/pdfjs/pdf_viewer.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
