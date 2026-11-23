import { NextResponse } from "next/server";
export function GET() {
  return NextResponse.json({ product: "averidi-dashboard", status: "scaffold", integration: "inactive" }, { headers: { "Cache-Control": "no-store" } });
}
