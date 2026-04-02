import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Upload a document for a transaction
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File;
  const txnId = formData.get("transaction_id") as string;

  if (!file || !txnId) {
    return NextResponse.json({ error: "File and transaction_id required" }, { status: 400 });
  }

  const db = getSupabase();
  const fileName = `${txnId}/${Date.now()}_${file.name}`;

  // Upload to Supabase storage
  const { error: uploadError } = await db.storage
    .from("transaction-documents")
    .upload(fileName, file, { contentType: file.type });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  // Get the URL
  const { data: urlData } = db.storage.from("transaction-documents").getPublicUrl(fileName);

  // Update the transaction's documents array
  const { data: txn } = await db.from("transactions").select("documents").eq("id", txnId).single();
  const docs = Array.isArray(txn?.documents) ? txn.documents : [];
  docs.push({
    name: file.name,
    path: fileName,
    type: file.type,
    size: file.size,
    uploaded_at: new Date().toISOString(),
  });

  await db.from("transactions").update({ documents: docs }).eq("id", txnId);

  return NextResponse.json({ message: "Document uploaded", path: fileName, url: urlData.publicUrl });
}

// List documents for a transaction
export async function GET(req: NextRequest) {
  const txnId = req.nextUrl.searchParams.get("transaction_id");
  if (!txnId) return NextResponse.json({ error: "transaction_id required" }, { status: 400 });

  const db = getSupabase();
  const { data: txn } = await db.from("transactions").select("documents").eq("id", txnId).single();

  const docs = Array.isArray(txn?.documents) ? txn.documents : [];

  // Generate signed URLs for each doc
  const docsWithUrls = await Promise.all(docs.map(async (doc: any) => {
    const { data } = await db.storage.from("transaction-documents").createSignedUrl(doc.path, 3600);
    return { ...doc, url: data?.signedUrl || "" };
  }));

  return NextResponse.json(docsWithUrls);
}
