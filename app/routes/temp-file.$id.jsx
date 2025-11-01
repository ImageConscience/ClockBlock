import { readFile, mkdir } from "fs/promises";
import { join } from "path";

// Temporary file directory - use absolute path based on app directory
// This ensures consistency between action and route (Railway uses /app as working dir)
const appDir = process.cwd() || "/app";
const TEMP_DIR = join(appDir, "temp", "uploads");

// Ensure temp directory exists
async function ensureTempDir() {
  try {
    await mkdir(TEMP_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
}

// Public route - NO authentication required (Shopify servers need to fetch files)
export const loader = async ({ params, request }) => {
  await ensureTempDir();
  
  const fileId = params.id;
  if (!fileId) {
    console.error("[TEMP-FILE] No file ID provided");
    return new Response("File not found", { status: 404 });
  }
  
  const filePath = join(TEMP_DIR, fileId);
  console.log("[TEMP-FILE] Looking for file:", filePath);
  console.log("[TEMP-FILE] TEMP_DIR:", TEMP_DIR);
  console.log("[TEMP-FILE] File ID:", fileId);
  console.log("[TEMP-FILE] Request URL:", request.url);
  console.log("[TEMP-FILE] User-Agent:", request.headers.get("user-agent"));
  
  try {
    const fileBuffer = await readFile(filePath);
    console.log("[TEMP-FILE] File found, size:", fileBuffer.length, "bytes");
    
    // Determine content type from file extension
    const ext = fileId.split('.').pop()?.toLowerCase();
    const contentTypeMap = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
    };
    const contentType = contentTypeMap[ext || ""] || "application/octet-stream";
    
    return new Response(fileBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("[TEMP-FILE] Error reading file:", error);
    console.error("[TEMP-FILE] Error message:", error.message);
    console.error("[TEMP-FILE] Error code:", error.code);
    return new Response(`File not found: ${error.message}`, { status: 404 });
  }
};

