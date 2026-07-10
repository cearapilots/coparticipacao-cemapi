/**
 * Utilitário CLIENTE — extrai texto de PDF usando pdfjs-dist.
 * Roda apenas no navegador (usa Worker/URL). Não importar no servidor.
 */
import * as pdfjsLib from "pdfjs-dist";
// @ts-expect-error - Vite resolve ?url para string em runtime
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let workerConfigured = false;
function ensureWorker() {
  if (!workerConfigured) {
    (pdfjsLib as unknown as { GlobalWorkerOptions: { workerSrc: string } })
      .GlobalWorkerOptions.workerSrc = workerSrc as unknown as string;
    workerConfigured = true;
  }
}

export async function extractPdfText(file: File): Promise<string> {
  ensureWorker();
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((it: any) => ("str" in it ? String(it.str ?? "") : ""));
    parts.push(strings.join(" "));
  }
  return parts.join("\n");
}

export async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
