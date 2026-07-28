import { NextResponse } from "next/server";

import { getDatabase } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "no-store",
};

export async function GET() {
  try {
    const db = getDatabase();
    await db.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
    return NextResponse.json({ status: "ok" }, { headers: responseHeaders });
  } catch {
    console.error("[health] database check failed");
    return NextResponse.json(
      { status: "unhealthy" },
      { status: 503, headers: responseHeaders },
    );
  }
}
