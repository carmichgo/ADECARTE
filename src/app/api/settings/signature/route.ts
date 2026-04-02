import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Upload reference signature
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File;
  const label = formData.get("label") as string || "default";

  if (!file) return NextResponse.json({ error: "File required" }, { status: 400 });

  const db = getSupabase();
  const fileName = `${label}_${Date.now()}.${file.name.split(".").pop()}`;

  const { error } = await db.storage
    .from("reference-signatures")
    .upload(fileName, file, { contentType: file.type, upsert: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ message: "Signature uploaded", path: fileName, label });
}

// List reference signatures
export async function GET() {
  const db = getSupabase();
  const { data, error } = await db.storage.from("reference-signatures").list("", { limit: 100 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const signatures = await Promise.all((data || []).filter(f => f.name !== ".emptyFolderPlaceholder").map(async f => {
    const { data: urlData } = await db.storage.from("reference-signatures").createSignedUrl(f.name, 3600);
    return { name: f.name, url: urlData?.signedUrl || "", size: f.metadata?.size, created: f.created_at };
  }));

  return NextResponse.json(signatures);
}

// Delete reference signature
export async function DELETE(req: NextRequest) {
  const { path } = await req.json();
  if (!path) return NextResponse.json({ error: "Path required" }, { status: 400 });

  const db = getSupabase();
  const { error } = await db.storage.from("reference-signatures").remove([path]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ message: "Deleted" });
}
