import { createHash } from 'node:crypto';

const padding = Buffer.from(
  '28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a',
  'hex',
);
const md5 = (data: Uint8Array) => createHash('md5').update(data).digest();
function rc4(key: Uint8Array, input: Uint8Array): Buffer {
  const state = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + state[i]! + key[i % key.length]!) % 256;
    [state[i], state[j]] = [state[j]!, state[i]!];
  }
  let i = 0;
  j = 0;
  return Buffer.from(
    input.map((byte) => {
      i = (i + 1) % 256;
      j = (j + state[i]!) % 256;
      [state[i], state[j]] = [state[j]!, state[i]!];
      return byte ^ state[(state[i]! + state[j]!) % 256]!;
    }),
  );
}

// Small, deterministic PDFs owned by the tests. Null pages contain only an image.
// Optional standard R2 encryption exercises the real PDF.js password failure.
export function pdfFixture(pages: (string | null)[], password?: string): Buffer {
  const objects: Buffer[] = [];
  const fileId = md5(Buffer.from('Saul PDF fixture'));
  const padded = (value: string) => Buffer.concat([Buffer.from(value), padding]).subarray(0, 32);
  const owner = rc4(md5(padded('owner')).subarray(0, 5), padded(password || ''));
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-4);
  const key = md5(Buffer.concat([padded(password || ''), owner, permissions, fileId])).subarray(
    0,
    5,
  );
  const add = (value: string | Buffer) =>
    objects.push(typeof value === 'string' ? Buffer.from(value, 'latin1') : value);
  const stream = (number: number, content: Buffer) => {
    if (password) {
      const suffix = Buffer.alloc(5);
      suffix.writeUIntLE(number, 0, 3);
      content = rc4(md5(Buffer.concat([key, suffix])).subarray(0, 10), content);
    }
    return Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
      content,
      Buffer.from('\nendstream'),
    ]);
  };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (const [index, text] of pages.entries()) {
    const number = 4 + index * 2;
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${number + 1} 0 R >>`,
    );
    const lines = text?.match(/.{1,90}/g) || [];
    // Inline 1x1 image for an image-only page; no text operators or OCR layer.
    const content =
      text === null
        ? 'q 400 0 0 600 50 50 cm BI /W 1 /H 1 /BPC 8 /CS /G ID \x80 EI Q'
        : `BT /F1 12 Tf 14 TL 50 740 Td ${lines.map((line) => `(${line.replace(/[\\()]/g, '\\$&')}) Tj T*`).join('\n')} ET`;
    add(stream(number + 1, Buffer.from(content, 'latin1')));
  }
  const encryptId = objects.length + 1;
  if (password)
    add(
      `<< /Filter /Standard /V 1 /R 2 /O <${owner.toString('hex')}> /U <${rc4(key, padding).toString('hex')}> /P -4 >>`,
    );
  const parts = [Buffer.from('%PDF-1.7\n')];
  const offsets = [0];
  let length = parts[0]!.length;
  for (const [index, value] of objects.entries()) {
    offsets.push(length);
    const part = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      value,
      Buffer.from('\nendobj\n'),
    ]);
    parts.push(part);
    length += part.length;
  }
  parts.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
        .join(
          '',
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /ID [<${fileId.toString('hex')}> <${fileId.toString('hex')}>]${password ? ` /Encrypt ${encryptId} 0 R` : ''} >>\nstartxref\n${length}\n%%EOF`,
    ),
  );
  return Buffer.concat(parts);
}
