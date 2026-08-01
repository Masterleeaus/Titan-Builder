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

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pushUint16(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushUint32(target, value) {
  target.push(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function createZipBytes(entries = []) {
  const local = [];
  const central = [];
  let offset = 0;
  const timestamp = dosDateTime();

  for (const entry of entries) {
    const name = String(entry.name ?? 'file')
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
      .map((part) => sanitizeExportName(part, 'file'))
      .join('/');
    const nameBytes = encoder.encode(name);
    const data = entry.data instanceof Uint8Array ? entry.data : encoder.encode(String(entry.data ?? ''));
    const checksum = crc32(data);
    const localHeader = [];
    pushUint32(localHeader, 0x04034b50);
    pushUint16(localHeader, 20);
    pushUint16(localHeader, 0x0800);
    pushUint16(localHeader, 0);
    pushUint16(localHeader, timestamp.time);
    pushUint16(localHeader, timestamp.date);
    pushUint32(localHeader, checksum);
    pushUint32(localHeader, data.length);
    pushUint32(localHeader, data.length);
    pushUint16(localHeader, nameBytes.length);
    pushUint16(localHeader, 0);
    local.push(...localHeader, ...nameBytes, ...data);

    const centralHeader = [];
    pushUint32(centralHeader, 0x02014b50);
    pushUint16(centralHeader, 20);
    pushUint16(centralHeader, 20);
    pushUint16(centralHeader, 0x0800);
    pushUint16(centralHeader, 0);
    pushUint16(centralHeader, timestamp.time);
    pushUint16(centralHeader, timestamp.date);
    pushUint32(centralHeader, checksum);
    pushUint32(centralHeader, data.length);
    pushUint32(centralHeader, data.length);
    pushUint16(centralHeader, nameBytes.length);
    pushUint16(centralHeader, 0);
    pushUint16(centralHeader, 0);
    pushUint16(centralHeader, 0);
    pushUint16(centralHeader, 0);
    pushUint32(centralHeader, 0);
    pushUint32(centralHeader, offset);
    central.push(...centralHeader, ...nameBytes);
    offset += localHeader.length + nameBytes.length + data.length;
  }

  const end = [];
  pushUint32(end, 0x06054b50);
  pushUint16(end, 0);
  pushUint16(end, 0);
  pushUint16(end, entries.length);
  pushUint16(end, entries.length);
  pushUint32(end, central.length);
  pushUint32(end, local.length);
  pushUint16(end, 0);
  return Uint8Array.from([...local, ...central, ...end]);
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
