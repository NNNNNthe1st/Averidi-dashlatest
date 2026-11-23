import "./dashboard-ui.css";
import type { ReactNode } from "react";
export const metadata = { title: "Averidi Dashboard", robots: { index: false, follow: false } };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body style={{fontFamily:"system-ui, sans-serif", margin:0}}>{children}</body></html>;
}
