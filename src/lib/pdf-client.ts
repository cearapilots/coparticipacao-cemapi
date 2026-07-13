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

interface PositionedItem { str: string; x: number; y: number; height: number }

// Reconstrói a ordem visual de leitura a partir dos itens de texto do pdfjs.
//
// getTextContent() devolve os itens na ordem de desenho do PDF, que para
// relatórios em tabela quase nunca é a ordem de leitura. Além disso, PDFs em
// paisagem/rotacionados têm o transform do item em espaço PDF (não visual):
// por isso aplicamos o `viewportTransform` (que já embute a rotação da página)
// a cada item, obtendo coordenadas VISUAIS reais (x cresce p/ direita, y cresce
// p/ baixo). Sem isso, agrupar por Y agrupava COLUNAS em vez de linhas.
//
// Exportado para permitir teste fora do navegador (harness com pdfjs em Node).
export function reconstructPageText(
  items: unknown[],
  viewportTransform: number[],
): string {
  const positioned: PositionedItem[] = [];
  for (const raw of items) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const it = raw as any;
    if (!("str" in it) || typeof it.str !== "string" || it.str.trim().length === 0) continue;
    if (!Array.isArray(it.transform)) continue;
    // Compõe viewportTransform × item.transform → posição visual do item.
    const m = pdfjsLib.Util.transform(viewportTransform, it.transform);
    positioned.push({
      str: it.str,
      x: m[4],
      y: m[5],
      height: Math.hypot(m[1], m[3]) || 10,
    });
  }

  // Em espaço de viewport, Y cresce para baixo → topo primeiro.
  positioned.sort((a, b) => a.y - b.y || a.x - b.x);

  // Alguns geradores simulam negrito redesenhando o MESMO texto quase na mesma
  // posição ("poor man's bold"), o que duplicava rótulos como "Titular".
  const deduped: PositionedItem[] = [];
  for (const item of positioned) {
    const prev = deduped[deduped.length - 1];
    const isDuplicate = prev && prev.str === item.str
      && Math.abs(prev.y - item.y) < 0.5
      && Math.abs(prev.x - item.x) < Math.max(item.height, 1);
    if (!isDuplicate) deduped.push(item);
  }

  // Agrupa em linhas: quebra quando o Y muda mais que ~60% da altura do texto.
  const lines: PositionedItem[][] = [];
  let currentLine: PositionedItem[] = [];
  for (const item of deduped) {
    if (currentLine.length > 0) {
      const ref = currentLine[0];
      const threshold = Math.max(ref.height, item.height) * 0.6;
      if (Math.abs(ref.y - item.y) > threshold) {
        lines.push(currentLine);
        currentLine = [];
      }
    }
    currentLine.push(item);
  }
  if (currentLine.length > 0) lines.push(currentLine);

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
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    parts.push(reconstructPageText(content.items, viewport.transform));
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
