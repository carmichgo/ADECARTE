import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  const { transactionId, documentPath, referenceSignaturePath } = await req.json();

  if (!documentPath || !referenceSignaturePath) {
    return NextResponse.json({ error: "Both document and reference signature paths required" }, { status: 400 });
  }

  const db = getSupabase();

  // Download both images
  const { data: docData, error: docErr } = await db.storage.from("transaction-documents").download(documentPath);
  if (docErr || !docData) return NextResponse.json({ error: "Failed to download document: " + docErr?.message }, { status: 500 });

  const { data: sigData, error: sigErr } = await db.storage.from("reference-signatures").download(referenceSignaturePath);
  if (sigErr || !sigData) return NextResponse.json({ error: "Failed to download signature: " + sigErr?.message }, { status: 500 });

  // Convert to base64
  const docBuffer = Buffer.from(await docData.arrayBuffer());
  const sigBuffer = Buffer.from(await sigData.arrayBuffer());
  const docBase64 = docBuffer.toString("base64");
  const sigBase64 = sigBuffer.toString("base64");

  const docType = documentPath.match(/\.(png|jpg|jpeg|gif|webp)$/i) ? `image/${documentPath.split(".").pop()?.toLowerCase().replace("jpg", "jpeg")}` : "image/png";
  const sigType = referenceSignaturePath.match(/\.(png|jpg|jpeg|gif|webp)$/i) ? `image/${referenceSignaturePath.split(".").pop()?.toLowerCase().replace("jpg", "jpeg")}` : "image/png";

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        {
          type: "text",
          text: `You are a forensic document examiner comparing signatures.

Image 1 is the REFERENCE (authentic) signature.
Image 2 is the DOCUMENT signature found on a transaction order.

Compare these two signatures and determine if the document signature appears authentic or potentially fraudulent.

Analyze:
1. Overall shape and flow
2. Stroke patterns and pressure
3. Letter formations
4. Size and proportions
5. Consistency with reference

Respond with ONLY a JSON object:
{
  "match": true/false,
  "confidence": 0.0-1.0,
  "assessment": "authentic" | "suspicious" | "likely_fraudulent",
  "reasoning": "detailed explanation",
  "differences": ["list of specific differences found"]
}`
        },
        {
          type: "image",
          source: { type: "base64", media_type: sigType as any, data: sigBase64 },
        },
        {
          type: "image",
          source: { type: "base64", media_type: docType as any, data: docBase64 },
        },
      ],
    }],
  });

  let resultText = response.content[0].type === "text" ? response.content[0].text.trim() : "";
  if (resultText.startsWith("```")) {
    resultText = resultText.split("\n").slice(1).join("\n").replace(/```\s*$/, "");
  }

  try {
    const result = JSON.parse(resultText);

    // Update transaction's fraudulent_signature field if transactionId provided
    if (transactionId) {
      const isFraudulent = result.assessment === "likely_fraudulent" || result.assessment === "suspicious";
      await db.from("transactions").update({
        fraudulent_signature: isFraudulent ? true : false,
      }).eq("id", transactionId);
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Failed to parse AI response", raw: resultText }, { status: 500 });
  }
}
