#!/usr/bin/env node

// Backwards-compatible command name. The quote catalog is no longer parsed
// back out of HTML; all consumer JSON files are rendered from one source.

import { syncProductData } from './sync-product-data.mjs';

const result = await syncProductData({ write: true });
console.log(
  `Catalog generated from src/data/products.json: ${result.products} products; ` +
  `changedFiles=${result.changedFiles.length}`
);
