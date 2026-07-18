import { NextRequest, NextResponse } from "next/server";
import { readLocalFile, verifyLocalSignature } from "@/lib/storage";

/**
 * Dev-only file server for the local storage driver. Production uses
 * Supabase Storage URLs and never hits this route. URLs are HMAC-signed
 * and expire, mirroring the signed-URL contract.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ bucket: string; path: string[] }> }
) {
  const { bucket, path: parts } = await ctx.params;
  const filePath = parts.join("/");
  const expires = Number(req.nextUrl.searchParams.get("e"));
  const sig = req.nextUrl.searchParams.get("s") ?? "";
  if (!expires || !verifyLocalSignature(bucket, filePath, expires, sig)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  try {
    const data = await readLocalFile(bucket, filePath);
    const ext = filePath.split(".").pop() ?? "";
    const types: Record<string, string> = {
      webp: "image/webp",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      pdf: "application/pdf",
    };
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": types[ext] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
