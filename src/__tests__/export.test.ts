import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  escapeCsvCell,
  generateCsv,
  normalizeCatalog,
  exportCatalogData,
  extractNumericId,
} from '../export.js';
import { RawProductNode } from '../types.js';

describe('Catalog Export & Normalization', () => {
  const testOutputDir = './output_test';

  beforeEach(() => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  it('extracts numeric ID from Shopify GID correctly', () => {
    expect(extractNumericId('gid://shopify/Product/8472910482')).toBe('8472910482');
    expect(extractNumericId('gid://shopify/ProductVariant/99887766')).toBe('99887766');
    expect(extractNumericId('12345')).toBe('12345');
  });

  it('protects against Excel formula injection', () => {
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeCsvCell('+SUM(A1:A10)')).toBe("'+SUM(A1:A10)");
    expect(escapeCsvCell('-20')).toBe("'-20");
    expect(escapeCsvCell('@cmd')).toBe("'@cmd");
    expect(escapeCsvCell('\tTabStart')).toBe("'\tTabStart");
  });

  it('properly quotes and escapes CSV cells with commas, quotes, and newlines', () => {
    expect(escapeCsvCell('Hello, World')).toBe('"Hello, World"');
    expect(escapeCsvCell('Say "Hello"')).toBe('"Say ""Hello"""');
    expect(escapeCsvCell('Line 1\nLine 2')).toBe('"Line 1\nLine 2"');
  });

  it('generates CSV with UTF-8 BOM (\uFEFF) at the start', () => {
    const csv = generateCsv(['ID', 'Name'], [{ ID: '1', Name: 'منتج تجريبي' }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('1,منتج تجريبي');
  });

  it('normalizes products containing multiple variants and missing optional fields', () => {
    const mockRawProduct: RawProductNode = {
      id: 'gid://shopify/Product/1001',
      title: 'T-Shirt Cotton (قطن)',
      handle: 't-shirt-cotton',
      description: 'High quality cotton shirt.',
      vendor: 'Demo Brand',
      productType: 'Apparel',
      category: {
        id: 'gid://shopify/TaxonomyCategory/1',
        name: 'Shirts & Tops',
      },
      tags: ['summer', 'cotton', 'قطن'],
      status: 'ACTIVE',
      onlineStoreUrl: 'https://store.example.com/products/t-shirt-cotton',
      featuredImage: {
        url: 'https://cdn.shopify.com/img1.jpg',
        altText: 'Shirt Image',
      },
      images: {
        pageInfo: { hasNextPage: false, endCursor: null },
        edges: [
          { node: { url: 'https://cdn.shopify.com/img1.jpg', altText: null } },
          { node: { url: 'https://cdn.shopify.com/img2.jpg', altText: null } },
        ],
      },
      variants: {
        pageInfo: { hasNextPage: false, endCursor: null },
        edges: [
          {
            node: {
              id: 'gid://shopify/ProductVariant/2001',
              title: 'Small / Blue',
              sku: 'TS-SM-BL',
              price: '120.00',
              compareAtPrice: '150.00',
              inventoryQuantity: 25,
              availableForSale: true,
              selectedOptions: [
                { name: 'Size', value: 'Small' },
                { name: 'Color', value: 'Blue' },
              ],
              image: { url: 'https://cdn.shopify.com/img-blue.jpg' },
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-02T00:00:00Z',
            },
          },
          {
            node: {
              id: 'gid://shopify/ProductVariant/2002',
              title: 'Medium / Red',
              sku: 'TS-MD-RD',
              price: '125.50',
              compareAtPrice: null, // missing compareAt
              inventoryQuantity: null, // missing inventory
              availableForSale: false,
              selectedOptions: [
                { name: 'Size', value: 'Medium' },
                { name: 'Color', value: 'Red' },
              ],
              image: null, // missing image
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-02T00:00:00Z',
            },
          },
        ],
      },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    };

    const { products, variants, malformedCount } = normalizeCatalog([mockRawProduct]);

    expect(products.length).toBe(1);
    expect(variants.length).toBe(2);
    expect(malformedCount).toBe(0);

    const product = products[0];
    expect(product.numeric_product_id).toBe('1001');
    expect(product.variant_count).toBe(2);
    expect(product.category).toBe('Shirts & Tops');
    expect(product.tags_formatted).toBe('summer; cotton; قطن');

    const v1 = variants[0];
    expect(v1.numeric_variant_id).toBe('2001');
    expect(v1.price).toBe(120.0);
    expect(v1.compare_at_price).toBe(150.0);
    expect(v1.inventory_quantity).toBe(25);
    expect(v1.available_for_sale).toBe(true);
    expect(v1.selected_options).toEqual({ Size: 'Small', Color: 'Blue' });

    const v2 = variants[1];
    expect(v2.numeric_variant_id).toBe('2002');
    expect(v2.price).toBe(125.5);
    expect(v2.compare_at_price).toBeNull();
    expect(v2.inventory_quantity).toBeNull();
    expect(v2.available_for_sale).toBe(false);
  });

  it('exports valid files on filesystem with correct records', async () => {
    const mockRawProduct: RawProductNode = {
      id: 'gid://shopify/Product/555',
      title: 'عسل سدر طبيعي 500 جرام',
      handle: 'sidr-honey-500g',
      description: 'عسل سدر بلدي فاخر ومفحوص مخبرياً.',
      vendor: 'Demo Organic',
      productType: 'Food',
      category: null,
      tags: ['honey', 'organic'],
      status: 'ACTIVE',
      onlineStoreUrl: null,
      featuredImage: null,
      images: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [] },
      variants: {
        pageInfo: { hasNextPage: false, endCursor: null },
        edges: [
          {
            node: {
              id: 'gid://shopify/ProductVariant/777',
              title: 'Default Title',
              sku: 'HONEY-500',
              price: '180.00',
              compareAtPrice: null,
              inventoryQuantity: 50,
              availableForSale: true,
              selectedOptions: [{ name: 'Title', value: 'Default Title' }],
              image: null,
              createdAt: '2026-02-01T00:00:00Z',
              updatedAt: '2026-02-01T00:00:00Z',
            },
          },
        ],
      },
      createdAt: '2026-02-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    };

    const summary = await exportCatalogData([mockRawProduct], testOutputDir);

    expect(summary.totalProducts).toBe(1);
    expect(summary.totalVariants).toBe(1);
    expect(summary.productsCsvRows).toBe(1);
    expect(summary.variantsCsvRows).toBe(1);

    expect(fs.existsSync(summary.jsonFilePath)).toBe(true);
    expect(fs.existsSync(summary.productsCsvFilePath)).toBe(true);
    expect(fs.existsSync(summary.variantsCsvFilePath)).toBe(true);

    const jsonContent = JSON.parse(fs.readFileSync(summary.jsonFilePath, 'utf-8'));
    expect(jsonContent[0].title).toBe('عسل سدر طبيعي 500 جرام');

    const csvContent = fs.readFileSync(summary.productsCsvFilePath, 'utf-8');
    expect(csvContent.charCodeAt(0)).toBe(0xfeff); // Has BOM
    expect(csvContent).toContain('عسل سدر طبيعي 500 جرام');
  });
});
