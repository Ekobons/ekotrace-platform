import { readFileSync, readdirSync } from 'node:fs';
import { pdfText } from '../src/lib/pdfText.js';
import { readBill } from '../src/lib/billRead.js';
const dir = process.argv[2]!;
let bad = 0;
for (const f of readdirSync(dir).sort()) {
  const t = await pdfText(new Uint8Array(readFileSync(`${dir}/${f}`)));
  const b = readBill(t.text);
  const line = `${f}\t${b.supplier?.value}\t${b.account?.value}\t${b.periodFrom?.value}..${b.periodTo?.value}\t${b.quantity?.value} ${b.quantity?.unit}\t${b.amount?.value} ${b.amount?.currency}\tmissing=${b.missing.join(',')}`;
  if (b.missing.length || !b.quantity) { bad++; console.log('BAD', line); }
  else if (/-(01|09)\.pdf/.test(f)) console.log(line);
}
console.log('bad', bad);
