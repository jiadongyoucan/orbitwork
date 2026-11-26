/** HTML → readable text. No dependencies; deliberately conservative. */

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', mdash: '—', ndash: '–',
  hellip: '…', copy: '©', reg: '®', trade: '™', laquo: '«', raquo: '»', times: '×', divide: '÷',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (all, code: string) => {
    if (code[0] === '#') {
      const hex = code[1] === 'x' || code[1] === 'X';
      const value = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

export function extractTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}

export function htmlToText(html: string, maxChars = 20_000): string {
  const text = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template|svg|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/pre|\/blockquote)\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…（已截断）` : text;
}

export function prettyJson(raw: string, maxChars = 20_000): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2).slice(0, maxChars);
  } catch {
    return raw.slice(0, maxChars);
  }
}
