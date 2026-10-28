import { PDFDocument, StandardFonts } from 'pdf-lib';

/** A one-page PDF with lines of text; [label, value] pairs are written in two columns. */
export async function makePdf(lines: (string | [string, string])[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let y = 800;
  for (const l of lines) {
    if (Array.isArray(l)) { page.drawText(l[0], { x: 40, y, size: 10, font }); page.drawText(l[1], { x: 300, y, size: 10, font }); }
    else page.drawText(l, { x: 40, y, size: 10, font });
    y -= 18;
  }
  return doc.save();
}

export const SAMPLE_ELECTRICITY: (string | [string, string])[] = [
  'Sharjah Electricity, Water and Gas Authority',
  'TAX INVOICE',
  ['Account No:', '2001458876'],
  ['Bill No:', 'INV-26-0412345'],
  ['Bill Date:', '05/04/2026'],
  ['Billing Period:', '01/03/2026 - 31/03/2026'],
  'Electricity',
  ['Previous Reading', '458120'],
  ['Current Reading', '503620'],
  ['Consumption', '45,500 kWh'],
  ['Rate', '0.38 AED/kWh'],
  'Water',
  ['Consumption', '1,250 IG'],
  ['Total Amount Due', 'AED 19,240.50'],
];


/** The same bill as a scan: the text PDF drawn to a JPEG at 150 dpi and placed as the only content of a new PDF. */
export async function makeScanPdf(lines: (string | [string, string])[]): Promise<Uint8Array> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: await makePdf(lines), verbosity: 0 });
  const src = await task.promise;
  const page = await src.getPage(1);
  const vp = page.getViewport({ scale: 150 / 72 });
  const cf = (src as unknown as { canvasFactory: { create: (w: number, h: number) => { canvas: { toBuffer: (t: string, q?: number) => Buffer }; context: { fillStyle: string; fillRect: (...a: number[]) => void } } } }).canvasFactory;
  const cc = cf.create(Math.ceil(vp.width), Math.ceil(vp.height));
  cc.context.fillStyle = '#ffffff'; cc.context.fillRect(0, 0, vp.width, vp.height);
  await page.render({ canvasContext: cc.context as never, viewport: vp, canvas: cc.canvas as never }).promise;
  const jpg = cc.canvas.toBuffer('image/jpeg', 80);
  await task.destroy();
  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(jpg);
  const p = doc.addPage([595, 842]);
  p.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  return doc.save();
}
