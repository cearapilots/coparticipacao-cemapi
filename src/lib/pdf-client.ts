/**
 * Utilitário CLIENTE — extrai texto de PDF usando pdfjs-dist.
 * Roda apenas no navegador (usa Worker/URL). Não importar no servidor.
 */
import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore - Vite resolve ?url para string em runtime
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let workerConfigured = false;
function ensureWorker() {
  if (!workerConfigured) {
    (pdfjsLib as unknown as { GlobalWorkerOptions: { workerSrc: string } })
      .GlobalWorkerOptions.workerSrc = workerSrc as unknown as string;
    workerConfigured = true;
  }
}

// pdfjs getTextContent() devolve os itens de texto na ordem em que foram
// desenhados no PDF, que para relatórios em tabela (colunas geradas por
// operadores de desenho separados) quase nunca é a ordem visual de leitura.
// Reconstrói a ordem visual agrupando itens por linha (coordenada Y, com
// tolerância) e ordenando cada linha por X — sem isso "Titular" e "Total da
// Família" chegam embaralhados no texto e o parser não consegue parear nada.
function reconstructPageText(items: unknown[]): string {
  interface PositionedItem { str: string; x: number; y: number }
  const positioned: PositionedItem[] = items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((it: any) => "str" in it && typeof it.str === "string" && it.str.trim().length > 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((it: any) => ({
      str: String(it.str),
      x: Number(it.transform?.[4] ?? 0),
      y: Number(it.transform?.[5] ?? 0),
    }));

  const Y_TOLERANCE = 2;
  const lines: PositionedItem[][] = [];
  for (const item of positioned) {
    const line = lines.find((l) => Math.abs(l[0].y - item.y) <= Y_TOLERANCE);
    if (line) line.push(item);
    else lines.push([item]);
  }
  // Y maior = mais acima na página (origem do PDF é embaixo-esquerda)
  lines.sort((a, b) => b[0].y - a[0].y);
  return lines
    .map((line) => line.slice().sort((a, b) => a.x - b.x).map((it) => it.str).join(" "))
    .join("\n");
}

export async function extractPdfText(file: File): Promise<string> {
  ensureWorker();
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    parts.push(reconstructPageText(content.items));
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
