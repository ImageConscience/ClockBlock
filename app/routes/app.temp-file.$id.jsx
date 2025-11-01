import { writeFile, readFile, mkdir, unlink } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Temporary file directory
const TEMP_DIR = join(__dirname, "../../../temp/uploads");

// Ensure temp directory exists
async function ensureTempDir() {
  try {
    await mkdir(TEMP_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
}

export const loader = async ({ params, request }) => {
  await ensureTempDir();
  
  const fileId = params.id;
  if (!fileId) {
    return new Response("File not found", { status: 404 });
  }
  
  const filePath = join(TEMP_DIR, fileId);
  
  try {
    const fileBuffer = await readFile(filePath);
    
    // Determine content type from file extension
    const ext = fileId.split('.').pop()?.toLowerCase();
    const contentTypeMap = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
    };
    const contentType = contentTypeMap[ext || ""] || "application/octet-stream";
    
    return new Response(fileBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    return new Response("File not found", { status: 404 });
  }
};

