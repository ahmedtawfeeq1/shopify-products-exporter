import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ShopifyGraphQLClient } from '../shopify.js';
import { resetTokenCache } from '../auth.js';

describe('Shopify GraphQL Client & Pagination', () => {
  const dummyConfig = {
    shop: 'demo-store.myshopify.com',
    apiVersion: '2026-10',
    accessToken: 'test_token',
  };

  beforeEach(() => {
    resetTokenCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('successfully tests connection and verifies read_products permission', async () => {
    const client = new ShopifyGraphQLClient(dummyConfig);

    vi.spyOn(globalThis, 'fetch')
      // Call 1: Shop query
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: {
              shop: {
                name: 'Demo Store',
                myshopifyDomain: 'demo-store.myshopify.com',
                primaryDomain: { url: 'https://demostore.com', host: 'demostore.com' },
                plan: { displayName: 'Shopify Plus' },
              },
            },
          }),
      } as unknown as Response)
      // Call 2: Product check
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: {
              products: {
                edges: [{ node: { id: 'gid://shopify/Product/1', title: 'Sample' } }],
              },
            },
          }),
      } as unknown as Response);

    const result = await client.testConnection();

    expect(result.success).toBe(true);
    expect(result.productAccessGranted).toBe(true);
    expect(result.shop?.name).toBe('Demo Store');
    expect(result.message).toContain('Product read access is verified');
  });

  it('detects missing read_products scope during testConnection', async () => {
    const client = new ShopifyGraphQLClient(dummyConfig);

    vi.spyOn(globalThis, 'fetch')
      // Call 1: Shop query succeeds
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: {
              shop: {
                name: 'Demo Store',
                myshopifyDomain: 'demo-store.myshopify.com',
              },
            },
          }),
      } as unknown as Response)
      // Call 2: Product query returns access denied
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            errors: [
              {
                message: 'Access denied for products field. Required access scope: read_products.',
              },
            ],
          }),
      } as unknown as Response);

    const result = await client.testConnection();

    expect(result.success).toBe(true);
    expect(result.productAccessGranted).toBe(false);
    expect(result.message).toContain("Missing 'read_products' scope");
    expect(result.message).toContain('Shopify Dev Dashboard');
  });

  it('paginates products correctly across multiple pages', async () => {
    const client = new ShopifyGraphQLClient(dummyConfig);

    vi.spyOn(globalThis, 'fetch')
      // Page 1: 1 product, hasNextPage = true
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: {
              products: {
                pageInfo: {
                  hasNextPage: true,
                  endCursor: 'cursor_page_1',
                },
                edges: [
                  {
                    cursor: 'c1',
                    node: {
                      id: 'gid://shopify/Product/1',
                      title: 'Product One',
                      handle: 'prod-one',
                      description: 'Desc 1',
                      tags: [],
                      status: 'ACTIVE',
                      variants: {
                        pageInfo: { hasNextPage: false, endCursor: null },
                        edges: [
                          {
                            node: {
                              id: 'gid://shopify/ProductVariant/10',
                              title: 'Default',
                              price: '10.00',
                              selectedOptions: [],
                            },
                          },
                        ],
                      },
                      images: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [] },
                    },
                  },
                ],
              },
            },
          }),
      } as unknown as Response)
      // Page 2: 1 product, hasNextPage = false
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: {
              products: {
                pageInfo: {
                  hasNextPage: false,
                  endCursor: null,
                },
                edges: [
                  {
                    cursor: 'c2',
                    node: {
                      id: 'gid://shopify/Product/2',
                      title: 'Product Two',
                      handle: 'prod-two',
                      description: 'Desc 2',
                      tags: [],
                      status: 'ACTIVE',
                      variants: {
                        pageInfo: { hasNextPage: false, endCursor: null },
                        edges: [
                          {
                            node: {
                              id: 'gid://shopify/ProductVariant/20',
                              title: 'Default',
                              price: '20.00',
                              selectedOptions: [],
                            },
                          },
                        ],
                      },
                      images: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [] },
                    },
                  },
                ],
              },
            },
          }),
      } as unknown as Response);

    const products = await client.fetchAllProducts();

    expect(products.length).toBe(2);
    expect(products[0].title).toBe('Product One');
    expect(products[1].title).toBe('Product Two');
  });

  it('sub-paginates variants when product has more than 100 variants', async () => {
    const client = new ShopifyGraphQLClient(dummyConfig);

    vi.spyOn(globalThis, 'fetch')
      // Main products page query returns a product with hasNextPage = true on variants
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: {
              products: {
                pageInfo: { hasNextPage: false, endCursor: null },
                edges: [
                  {
                    cursor: 'c1',
                    node: {
                      id: 'gid://shopify/Product/999',
                      title: 'Multi Variant Product',
                      handle: 'multi-var',
                      description: 'Many variants',
                      tags: [],
                      status: 'ACTIVE',
                      images: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [] },
                      variants: {
                        pageInfo: { hasNextPage: true, endCursor: 'var_cursor_1' },
                        edges: [
                          {
                            node: {
                              id: 'gid://shopify/ProductVariant/1',
                              title: 'Variant Batch 1',
                              price: '15.00',
                              selectedOptions: [],
                            },
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          }),
      } as unknown as Response)
      // Follow-up subquery for remaining variants
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: {
              product: {
                variants: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  edges: [
                    {
                      node: {
                        id: 'gid://shopify/ProductVariant/2',
                        title: 'Variant Batch 2',
                        price: '18.00',
                        selectedOptions: [],
                      },
                    },
                  ],
                },
              },
            },
          }),
      } as unknown as Response);

    const products = await client.fetchAllProducts();

    expect(products.length).toBe(1);
    expect(products[0].variants.edges.length).toBe(2);
    expect(products[0].variants.edges[0].node.title).toBe('Variant Batch 1');
    expect(products[0].variants.edges[1].node.title).toBe('Variant Batch 2');
  });

  it('retries on HTTP 429 rate limit with backoff and succeeds on next attempt', async () => {
    const client = new ShopifyGraphQLClient(dummyConfig);

    vi.spyOn(globalThis, 'fetch')
      // First attempt: 429 Throttled
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '0.1' }),
        text: async () => 'Rate limit exceeded',
      } as unknown as Response)
      // Second attempt: succeeds
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: {
              shop: { name: 'Throttling Recovered Store', myshopifyDomain: 'test.myshopify.com' },
            },
          }),
      } as unknown as Response);

    const response = await client.executeGraphQL<{ shop: { name: string } }>(
      'query { shop { name } }'
    );
    expect(response.data?.shop.name).toBe('Throttling Recovered Store');
  });
});
