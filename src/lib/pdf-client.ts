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
// Reconstrói a ordem visual agrupando itens por linha e ordenando cada linha
// por X — sem isso "Titular" e "Total da Família" chegam embaralhados e o
// parser não consegue parear nada.
function reconstructPageText(items: unknown[]): string {
  interface PositionedItem { str: string; x: number; y: number; height: number }
  const positioned: PositionedItem[] = items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((it: any) => "str" in it && typeof it.str === "string" && it.str.trim().length > 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((it: any) => ({
      str: String(it.str),
      x: Number(it.transform?.[4] ?? 0),
      y: Number(it.transform?.[5] ?? 0),
      height: Math.abs(Number(it.transform?.[3] ?? it.height ?? 10)) || 10,
    }));

  // Alguns geradores de PDF simulam negrito desenhando o MESMO texto duas
  // vezes quase na mesma posição ("poor man's bold"). Isso duplicava
  // rótulos como "Titular" (daí "Titular Titular Titular..."). Remove
  // duplicata exata de texto muito próxima em X/Y antes de reconstruir.
  positioned.sort((a, b) => b.y - a.y || a.x - b.x);
  const deduped: PositionedItem[] = [];
  for (const item of positioned) {
    const prev = deduped[deduped.length - 1];
    const isDuplicate = prev && prev.str === item.str
      && Math.abs(prev.y - item.y) < 0.5
      && Math.abs(prev.x - item.x) < Math.max(item.height, 1);
    if (!isDuplicate) deduped.push(item);
  }

  // Agrupa em linhas: quebra quando o Y muda mais que ~metade da altura do
  // texto — limiar relativo ao tamanho de fonte real do PDF, não um valor
  // fixo em pontos (que pode não bater com a escala deste documento).
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
