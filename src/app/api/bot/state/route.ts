import { NextResponse } from "next/server";
import { botState } from "@/lib/bot";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await botState();
    return NextResponse.json(state);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
