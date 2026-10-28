/**
 * Bill reading: sample bill layouts (made up, in the style of UAE utility bills) as PDFs
 * generated here, read back with PDF.js, then parsed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { makePdf, makeScanPdf, SAMPLE_ELECTRICITY } from './helpers/pdf.js';
import { ocrPdf, stopOcr } from '../src/lib/ocr.js';
import { pdfText } from '../src/lib/pdfText.js';
import { parseDate, readBill } from '../src/lib/billRead.js';

test('dates as written on bills', () => {
  assert.equal(parseDate('05/04/2026'), '2026-04-05');
  assert.equal(parseDate('1-Mar-2026'), '2026-03-01');
  assert.equal(parseDate('31 March 2026'), '2026-03-31');
  assert.equal(parseDate('Mar 31, 2026'), '2026-03-31');
  assert.equal(parseDate('31/02/2026'), null);
});

test('electricity bill PDF: supplier, account, period, kWh (not the readings, rate or water), amount', async () => {
  const pdf = await makePdf(SAMPLE_ELECTRICITY);
  const t = await pdfText(pdf);
  assert.equal(t.scanned, false);
  const r = readBill(t.text);
  assert.equal(r.supplier?.value, 'SEWA');
  assert.equal(r.account?.value, '2001458876');
  assert.equal(r.billNo?.value, 'INV-26-0412345');
  assert.equal(r.periodFrom?.value, '2026-03-01');
  assert.equal(r.periodTo?.value, '2026-03-31');
  assert.equal(r.issueDate?.value, '2026-04-05');
  assert.deepEqual([r.quantity?.value, r.quantity?.unit], [45500, 'kWh_e']);
  assert.deepEqual([r.amount?.value, r.amount?.currency], [19240.5, 'AED']);
  assert.deepEqual(r.missing, []);
});

test('district cooling bill in ton-hours; reading-date period; value on the next line', () => {
  const r = readBill(['Emirates Central Cooling Systems Corporation (Empower)', 'Customer No: C-778812', 'Previous reading date: 01-Feb-2026', 'Current reading date: 28-Feb-2026',
    'Consumption (RTh)', '182,400', 'Capacity charge 1,200 RT', 'Net amount AED 112,560.00'].join('\n'));
  assert.equal(r.supplier?.value, 'Empower');
  assert.equal(r.account?.value, 'C-778812');
  assert.deepEqual([r.periodFrom?.value, r.periodTo?.value], ['2026-02-01', '2026-02-28']);
  assert.deepEqual([r.quantity?.value, r.quantity?.unit], [182400, 'TRh']);
  assert.equal(r.amount?.value, 112560);
});

test('unknown layout: consumption from readings; missing fields listed', () => {
  const r = readBill(['Some Power Co', 'Previous reading 10,200', 'Current reading 12,950', 'Total due 1,045.00'].join('\n'));
  assert.deepEqual([r.quantity?.value, r.quantity?.unit], [2750, 'kWh_e']);
  assert.ok(r.missing.includes('supplier') && r.missing.includes('billing period'));
});

test('a scan (no text) is recognised', async () => {
  const doc = await PDFDocument.create(); doc.addPage([595, 842]);
  assert.equal((await pdfText(await doc.save())).scanned, true);
});

test('water bill: the same combined electricity & water PDF read for water gives the water consumption (imperial gallons), not the kWh', async () => {
  const pdf = await makePdf(SAMPLE_ELECTRICITY);
  const t = await pdfText(pdf);
  const w = readBill(t.text, 'water');
  assert.deepEqual([w.quantity?.value, w.quantity?.unit, w.quantity?.energy], [1250, 'gal_uk', 'water']);
  assert.deepEqual([readBill(t.text).quantity?.value, readBill(t.text).quantity?.unit], [45500, 'kWh_e']);
  assert.deepEqual([readBill('Water consumption: 3,410 m3\nTotal due 1,000.00', 'water').quantity?.unit, readBill('Water consumption 12 000 IG\n', 'water').quantity?.unit], ['m3', 'kgal_uk']);
});

test('scanned bill: no text, read by OCR on the server, then the same reader finds the figures', async () => {
  const scan = await makeScanPdf(SAMPLE_ELECTRICITY);
  const t = await pdfText(scan);
  assert.equal(t.scanned, true);
  try {
    const o = await ocrPdf(scan);
    assert.ok(o.confidence > 60, `confidence ${o.confidence}`);
    const r = readBill(o.text);
    assert.equal(r.account?.value, '2001458876');
    assert.equal(r.periodFrom?.value, '2026-03-01'); assert.equal(r.periodTo?.value, '2026-03-31');
    assert.equal(r.quantity?.value, 45500); assert.equal(r.quantity?.unit, 'kWh_e');
    assert.equal(r.amount?.value, 19240.5);
  } finally { await stopOcr(); }
});

test('OCR is kept apart: a job past its time is stopped and the next one still runs; the queue is short', async () => {
  const scan = await makeScanPdf(SAMPLE_ELECTRICITY);
  try {
    await assert.rejects(ocrPdf(scan, 4, 30), /too long/);                       // killed, not left running
    const ok = await ocrPdf(scan);                                               // a fresh OCR process
    assert.equal(readBill(ok.text).quantity?.value, 45500);
    const jobs = [0, 1, 2, 3, 4].map(() => ocrPdf(scan).then(() => 'ok', (e: Error) => e.message));
    const out = await Promise.all(jobs);
    assert.ok(out.some((x) => /busy/.test(x)), out.join(' | '));                 // more than three waiting: told to try later
    assert.ok(out.filter((x) => x === 'ok').length >= 3);
  } finally { await stopOcr(); }
});
