import fs from 'node:fs';
import path from 'node:path';
import {
  RawProductNode,
  NormalizedProduct,
  NormalizedVariant,
  ExportSummary,
} from './types.js';
import { cleanDescription } from './cleaner.js';

/**
 * Extracts numeric ID from Shopify GID (e.g. "gid://shopify/Product/12345" -> "12345")
 */
export function extractNumericId(gid: string): string {
  const match = gid.match(/\/([0-9]+)$/);
  return match ? match[1] : gid;
}

/**
 * Escapes a CSV cell according to RFC 4180 and protects against Excel formula injection.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  let str = String(value);

  // Excel Formula Injection Prevention:
  // If text starts with dangerous formula triggers (=, +, -, @, tab, CR), prepend a single quote
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // If contains commas, double quotes, or newlines, quote the entire field and escape quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    str = `"${str.replaceAll('"', '""')}"`;
  }

  return str;
}

/**
 * Converts a list of records to CSV string with UTF-8 BOM.
 */
export function generateCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const BOM = '\uFEFF';
  const headerLine = headers.map((h) => escapeCsvCell(h)).join(',');

  const dataLines = rows.map((row) => {
    return headers.map((header) => escapeCsvCell(row[header])).join(',');
  });

  return BOM + [headerLine, ...dataLines].join('\n');
}

/**
 * Normalizes raw Shopify GraphQL product and variant nodes into structured, clean data.
 */
export function normalizeCatalog(rawProducts: RawProductNode[]): {
  products: NormalizedProduct[];
  variants: NormalizedVariant[];
  malformedCount: number;
} {
  const products: NormalizedProduct[] = [];
  const allVariants: NormalizedVariant[] = [];
  let malformedCount = 0;

  for (const raw of rawProducts) {
    const numericProductId = extractNumericId(raw.id);
    const cleanedDesc = cleanDescription(raw.description, raw.descriptionHtml);

    if (cleanedDesc.isMalformed) {
      malformedCount++;
    }

    const mediaUrls = (raw.images?.edges || [])
      .map((e) => e.node?.url)
      .filter((url): url is string => Boolean(url));

    const productVariants: NormalizedVariant[] = [];

    for (const vEdge of raw.variants?.edges || []) {
      const v = vEdge.node;
      const numericVariantId = extractNumericId(v.id);

      const optionsMap: Record<string, string> = {};
      const optionsParts: string[] = [];

      for (const opt of v.selectedOptions || []) {
        optionsMap[opt.name] = opt.value;
        optionsParts.push(`${opt.name}: ${opt.value}`);
      }

      const parsedPrice = parseFloat(v.price) || 0;
      const parsedCompareAt = v.compareAtPrice ? parseFloat(v.compareAtPrice) : null;

      const normalizedVariant: NormalizedVariant = {
        shopify_variant_id: v.id,
        numeric_variant_id: numericVariantId,
        shopify_product_id: raw.id,
        product_title: raw.title,
        product_handle: raw.handle,
        variant_title: v.title,
        sku: v.sku || '',
        price: parsedPrice,
        compare_at_price: parsedCompareAt,
        inventory_quantity: typeof v.inventoryQuantity === 'number' ? v.inventoryQuantity : null,
        available_for_sale: Boolean(v.availableForSale),
        selected_options: optionsMap,
        selected_options_summary: optionsParts.join('; '),
        variant_image_url: v.image?.url || '',
        created_at: v.createdAt || raw.createdAt,
        updated_at: v.updatedAt || raw.updatedAt,
      };

      productVariants.push(normalizedVariant);
      allVariants.push(normalizedVariant);
    }

    const normalizedProduct: NormalizedProduct = {
      shopify_product_id: raw.id,
      numeric_product_id: numericProductId,
      title: raw.title,
      handle: raw.handle,
      description: cleanedDesc.text,
      vendor: raw.vendor || '',
      product_type: raw.productType || '',
      category: raw.category?.name || '',
      tags: raw.tags || [],
      tags_formatted: (raw.tags || []).join('; '),
      status: raw.status || '',
      product_url: raw.onlineStoreUrl || '',
      featured_image_url: raw.featuredImage?.url || (mediaUrls.length > 0 ? mediaUrls[0] : ''),
      media_image_urls: mediaUrls,
      created_at: raw.createdAt,
      updated_at: raw.updatedAt,
      variant_count: productVariants.length,
      has_malformed_encoding: cleanedDesc.isMalformed,
      variants: productVariants,
    };

    products.push(normalizedProduct);
  }

  return {
    products,
    variants: allVariants,
    malformedCount,
  };
}

/**
 * Writes the normalized catalog to JSON and CSV files.
 */
export async function writeExportFiles(
  products: NormalizedProduct[],
  variants: NormalizedVariant[],
  outputDir = './output'
): Promise<{
  jsonPath: string;
  productsCsvPath: string;
  variantsCsvPath: string;
}> {
  const resolvedDir = path.resolve(process.cwd(), outputDir);
  if (!fs.existsSync(resolvedDir)) {
    fs.mkdirSync(resolvedDir, { recursive: true });
  }

  const jsonPath = path.join(resolvedDir, 'products_clean.json');
  const productsCsvPath = path.join(resolvedDir, 'products_clean.csv');
  const variantsCsvPath = path.join(resolvedDir, 'variants_clean.csv');

  // 1. Write structured products_clean.json
  fs.writeFileSync(jsonPath, JSON.stringify(products, null, 2), 'utf-8');

  // 2. Write products_clean.csv
  const productHeaders = [
    'shopify_product_id',
    'numeric_product_id',
    'title',
    'handle',
    'status',
    'vendor',
    'product_type',
    'category',
    'tags',
    'description',
    'variant_count',
    'product_url',
    'featured_image_url',
    'media_image_urls',
    'created_at',
    'updated_at',
    'has_malformed_encoding',
  ];

  const productCsvRows = products.map((p) => ({
    shopify_product_id: p.shopify_product_id,
    numeric_product_id: p.numeric_product_id,
    title: p.title,
    handle: p.handle,
    status: p.status,
    vendor: p.vendor,
    product_type: p.product_type,
    category: p.category,
    tags: p.tags_formatted,
    description: p.description,
    variant_count: p.variant_count,
    product_url: p.product_url,
    featured_image_url: p.featured_image_url,
    media_image_urls: p.media_image_urls.join('; '),
    created_at: p.created_at,
    updated_at: p.updated_at,
    has_malformed_encoding: p.has_malformed_encoding ? 'YES' : 'NO',
  }));

  const productsCsvContent = generateCsv(productHeaders, productCsvRows);
  fs.writeFileSync(productsCsvPath, productsCsvContent, 'utf-8');

  // 3. Write variants_clean.csv
  const variantHeaders = [
    'shopify_variant_id',
    'numeric_variant_id',
    'shopify_product_id',
    'product_title',
    'product_handle',
    'variant_title',
    'sku',
    'price',
    'compare_at_price',
    'inventory_quantity',
    'available_for_sale',
    'selected_options',
    'variant_image_url',
    'created_at',
    'updated_at',
  ];

  const variantCsvRows = variants.map((v) => ({
    shopify_variant_id: v.shopify_variant_id,
    numeric_variant_id: v.numeric_variant_id,
    shopify_product_id: v.shopify_product_id,
    product_title: v.product_title,
    product_handle: v.product_handle,
    variant_title: v.variant_title,
    sku: v.sku,
    price: v.price.toFixed(2),
    compare_at_price: v.compare_at_price !== null ? v.compare_at_price.toFixed(2) : '',
    inventory_quantity: v.inventory_quantity !== null ? v.inventory_quantity : '',
    available_for_sale: v.available_for_sale ? 'TRUE' : 'FALSE',
    selected_options: v.selected_options_summary,
    variant_image_url: v.variant_image_url,
    created_at: v.created_at,
    updated_at: v.updated_at,
  }));

  const variantsCsvContent = generateCsv(variantHeaders, variantCsvRows);
  fs.writeFileSync(variantsCsvPath, variantsCsvContent, 'utf-8');

  return {
    jsonPath,
    productsCsvPath,
    variantsCsvPath,
  };
}

/**
 * High-level function that normalizes raw products and exports all files.
 */
export async function exportCatalogData(
  rawProducts: RawProductNode[],
  outputDir = './output',
  startTimeMs = Date.now()
): Promise<ExportSummary> {
  const { products, variants, malformedCount } = normalizeCatalog(rawProducts);
  const filePaths = await writeExportFiles(products, variants, outputDir);
  const durationSeconds = (Date.now() - startTimeMs) / 1000;

  return {
    totalProducts: products.length,
    totalVariants: variants.length,
    malformedEncodingCount: malformedCount,
    jsonFilePath: filePaths.jsonPath,
    productsCsvFilePath: filePaths.productsCsvPath,
    variantsCsvFilePath: filePaths.variantsCsvPath,
    productsCsvRows: products.length,
    variantsCsvRows: variants.length,
    durationSeconds: parseFloat(durationSeconds.toFixed(2)),
  };
}
