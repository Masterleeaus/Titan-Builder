const encoder = new TextEncoder();

export function sanitizeExportName(value, fallback = 'openbrowser-export') {
  const raw = String(value ?? '').trim().replace(/\\/g, '/').split('/').pop() ?? '';
  const normalized = raw
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  const safe = normalized || fallback;
  if (safe.length <= 120) return safe;
  const dot = safe.lastIndexOf('.');
  const extension = dot > 0 && safe.length - dot <= 12 ? safe.slice(dot) : '';
  return `${safe.slice(0, 120 - extension.length)}${extension}`;
}

export function selectExportItems(items = [], { mode = 'selected', selectedIds = [], focusId = '' } = {}) {
  if (mode === 'all') return [...items];
  if (mode === 'one') return items.filter((item) => item.id === focusId).slice(0, 1);
  const ids = new Set(selectedIds);
  return items.filter((item) => ids.has(item.id));
}

export function buildMarkdownExport(items = [], { title = 'OpenBrowser export', exportedAt = new Date().toISOString() } = {}) {
  const lines = [
    `# ${String(title).trim() || 'OpenBrowser export'}`,
    '',
    `Exported: ${exportedAt}`,
    '',
  ];
  for (const [index, item] of items.entries()) {
    const name = String(item.name ?? item.title ?? `Item ${index + 1}`).trim();
    lines.push(`## ${name}`, '');
    if (item.type) lines.push(`- Type: ${item.type}`);
    if (item.size != null) lines.push(`- Size: ${item.size} bytes`);
    if (item.url) lines.push(`- Source: ${item.url}`);
    if (item.source) lines.push(`- Discovered from: ${item.source}`);
    if (item.text) {
      lines.push('', String(item.text).trim(), '');
    } else {
      lines.push('', '_File content was not embedded. Use the source link or ZIP export when the visible download URL is accessible._', '');
    }
  }
  return `${lines.join('\n').trim()}\n`;
}

const CRC32_TABLE = new Uint32Array(256);
for (let value = 0; value < CRC32_TABLE.length; value += 1) {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  CRC32_TABLE[value] = crc >>> 0;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
  return offset + 2;
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value, true);
  return offset + 4;
}

function dosDateTime(date = new Date()) {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function normalizeZipEntry(entry) {
  const name = String(entry.name ?? 'file')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((part) => sanitizeExportName(part, 'file'))
    .join('/') || 'file';
  const nameBytes = encoder.encode(name);
  const data = entry.data instanceof Uint8Array ? entry.data : encoder.encode(String(entry.data ?? ''));

  if (nameBytes.length > 0xffff) {
    throw new RangeError(`ZIP entry name is too long: ${name}`);
  }
  if (data.length > 0xffffffff) {
    throw new RangeError(`ZIP entry is too large for the classic ZIP format: ${name}`);
  }

  return {
    nameBytes,
    data,
    checksum: crc32(data),
    localOffset: 0,
  };
}

export function createZipBytes(entries = []) {
  if (entries.length > 0xffff) {
    throw new RangeError('Classic ZIP archives support at most 65,535 entries.');
  }

  const normalized = entries.map(normalizeZipEntry);
  const localLength = normalized.reduce(
    (total, entry) => total + 30 + entry.nameBytes.length + entry.data.length,
    0,
  );
  const centralLength = normalized.reduce(
    (total, entry) => total + 46 + entry.nameBytes.length,
    0,
  );
  const totalLength = localLength + centralLength + 22;

  if (!Number.isSafeInteger(totalLength) || localLength > 0xffffffff || centralLength > 0xffffffff) {
    throw new RangeError('ZIP archive exceeds classic ZIP size limits.');
  }

  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const timestamp = dosDateTime();
  let cursor = 0;

  for (const entry of normalized) {
    entry.localOffset = cursor;
    cursor = writeUint32(view, cursor, 0x04034b50);
    cursor = writeUint16(view, cursor, 20);
    cursor = writeUint16(view, cursor, 0x0800);
    cursor = writeUint16(view, cursor, 0);
    cursor = writeUint16(view, cursor, timestamp.time);
    cursor = writeUint16(view, cursor, timestamp.date);
    cursor = writeUint32(view, cursor, entry.checksum);
    cursor = writeUint32(view, cursor, entry.data.length);
    cursor = writeUint32(view, cursor, entry.data.length);
    cursor = writeUint16(view, cursor, entry.nameBytes.length);
    cursor = writeUint16(view, cursor, 0);
    output.set(entry.nameBytes, cursor);
    cursor += entry.nameBytes.length;
    output.set(entry.data, cursor);
    cursor += entry.data.length;
  }

  const centralOffset = cursor;
  for (const entry of normalized) {
    cursor = writeUint32(view, cursor, 0x02014b50);
    cursor = writeUint16(view, cursor, 20);
    cursor = writeUint16(view, cursor, 20);
    cursor = writeUint16(view, cursor, 0x0800);
    cursor = writeUint16(view, cursor, 0);
    cursor = writeUint16(view, cursor, timestamp.time);
    cursor = writeUint16(view, cursor, timestamp.date);
    cursor = writeUint32(view, cursor, entry.checksum);
    cursor = writeUint32(view, cursor, entry.data.length);
    cursor = writeUint32(view, cursor, entry.data.length);
    cursor = writeUint16(view, cursor, entry.nameBytes.length);
    cursor = writeUint16(view, cursor, 0);
    cursor = writeUint16(view, cursor, 0);
    cursor = writeUint16(view, cursor, 0);
    cursor = writeUint16(view, cursor, 0);
    cursor = writeUint32(view, cursor, 0);
    cursor = writeUint32(view, cursor, entry.localOffset);
    output.set(entry.nameBytes, cursor);
    cursor += entry.nameBytes.length;
  }

  cursor = writeUint32(view, cursor, 0x06054b50);
  cursor = writeUint16(view, cursor, 0);
  cursor = writeUint16(view, cursor, 0);
  cursor = writeUint16(view, cursor, normalized.length);
  cursor = writeUint16(view, cursor, normalized.length);
  cursor = writeUint32(view, cursor, centralLength);
  cursor = writeUint32(view, cursor, centralOffset);
  cursor = writeUint16(view, cursor, 0);

  if (cursor !== output.length) {
    throw new Error(`ZIP assembly length mismatch: wrote ${cursor}, allocated ${output.length}`);
  }
  return output;
}

export function base64ToBytes(value) {
  const binary = atob(String(value ?? ''));
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}

export function downloadBytes(bytes, filename, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = sanitizeExportName(filename);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
