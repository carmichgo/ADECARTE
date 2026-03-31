import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await getSupabase()
    .from("categories")
    .select("*")
    .order("is_suspicious")
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { error } = await getSupabase().from("categories").insert({
    name: body.name,
    description: body.description || "",
    is_suspicious: body.is_suspicious || false,
  });

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Category already exists" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ message: "Category added" });
}
