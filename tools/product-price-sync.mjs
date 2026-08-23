import path from 'node:path';
import { formatPrice } from './product-data.mjs';

export function displayPrice(price) {
  return price.kind === 'from' ? formatPrice(price.amount) : 'по запросу';
}

export function syncProductPagePrice(html, product) {
  const expected = displayPrice(product.price);
  let visibleMatches = 0;
  let productJsonLdMatches = 0;

  let output = html.replace(
    /(<div\s+class=["'][^"']*\bpp-price\b[^"']*["'][^>]*>[\s\S]*?<span\s+class=["'][^"']*\bbig\b[^"']*["'][^>]*>)[\s\S]*?(<\/span>)/i,
    (_whole, before, after) => {
      visibleMatches++;
      return `${before}${expected}${after}`;
    }
  );

  output = output.replace(
    /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    (whole, raw) => {
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return whole;
      }
      if (data?.['@type'] !== 'Product') return whole;
      productJsonLdMatches++;
      if (product.price.kind === 'from') {
        data.offers = {
          '@type': 'AggregateOffer',
          priceCurrency: 'RUB',
          lowPrice: String(product.price.amount),
          availability: 'https://schema.org/PreOrder',
          seller: { '@type': 'Organization', name: 'EGOE' },
        };
      } else {
        delete data.offers;
      }
      return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
    }
  );

  if (visibleMatches !== 1) throw new Error(`${product.url}: expected exactly one visible pp-price`);
  if (productJsonLdMatches !== 1) throw new Error(`${product.url}: expected exactly one Product JSON-LD block`);
  return output;
}

function normalizeLinkedRoute(pageRel, href) {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean || clean.startsWith('#') || clean.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(clean)) return null;
  const pageDir = path.posix.dirname(pageRel);
  const resolved = path.posix.normalize(path.posix.join(pageDir, clean));
  if (resolved.startsWith('../')) return null;
  return resolved.replace(/(?:\/index\.html)?\/?$/, '/');
}

export function syncLinkedCardPrices(html, pageRel, changesByUrl) {
  return html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (anchor) => {
    const href = anchor.match(/\bhref=["']([^"']+)["']/i)?.[1];
    const route = href ? normalizeLinkedRoute(pageRel, href) : null;
    const change = route ? changesByUrl.get(route) : null;
    if (!change) return anchor;

    const oldText = displayPrice(change.before);
    const nextText = displayPrice(change.after);
    const escaped = change.before.kind === 'onrequest'
      ? '(?:под[\\s\\u00a0\\u2009]+заказ|по[\\s\\u00a0\\u2009]+запросу)'
      : oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s\\u00a0\\u2009]+');
    return anchor.replace(new RegExp(escaped, 'gi'), nextText);
  });
}
