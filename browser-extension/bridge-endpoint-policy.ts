const IPV4_AUTHORITY_PATTERN = /^(127(?:\.(?:0|[1-9]\d{0,2})){3}):([1-9]\d{0,4})$/u;
const IPV6_AUTHORITY_PATTERN = /^\[::1\]:([1-9]\d{0,4})$/iu;

export function parseLoopbackBridgeUrl(value: string): URL {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('Bridge URL is required');
  if (!/^http:\/\//iu.test(raw)) throw new Error('Bridge URL must use HTTP');
  if (raw.includes('@')) throw new Error('Bridge URL credentials are not allowed');
  if (raw.includes('?')) throw new Error('Bridge URL query parameters are not allowed');
  if (raw.includes('#')) throw new Error('Bridge URL fragments are not allowed');

  const authorityAndPath = raw.slice('http://'.length);
  const slashIndex = authorityAndPath.indexOf('/');
  const authority = slashIndex === -1
    ? authorityAndPath
    : authorityAndPath.slice(0, slashIndex);
  const pathname = slashIndex === -1 ? '' : authorityAndPath.slice(slashIndex);
  if (pathname && pathname !== '/') {
    throw new Error('Bridge URL path must be exactly /');
  }

  let portText: string;
  const ipv4Match = IPV4_AUTHORITY_PATTERN.exec(authority);
  const ipv6Match = IPV6_AUTHORITY_PATTERN.exec(authority);
  if (ipv4Match) {
    const octets = ipv4Match[1].split('.').map(Number);
    if (octets.some((octet) => octet > 255)) {
      throw new Error('Bridge URL must use a canonical loopback address');
    }
    portText = ipv4Match[2];
  } else if (ipv6Match) {
    portText = ipv6Match[1];
  } else {
    throw new Error('Bridge URL must use canonical IPv4 127/8 or IPv6 ::1 loopback');
  }

  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Bridge URL port must be between 1 and 65535');
  }

  return new URL(`${raw.replace(/\/$/u, '')}/`);
}
