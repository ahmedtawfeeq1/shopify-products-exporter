import {
  ShopifyConfig,
  GraphQLResponse,
  ConnectionTestResult,
  RawProductNode,
  RawVariantNode,
  RawImageNode,
  CostExtension,
} from './types.js';
import { getAccessToken, normalizeShopDomain, sanitizeLog, loadShopifyConfig } from './auth.js';

/**
 * Sleep helper for rate limiting and backoff
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ShopifyGraphQLClient {
  private config: ShopifyConfig;
  private graphqlEndpoint: string;

  constructor(customConfig?: Partial<ShopifyConfig>) {
    const base = loadShopifyConfig();
    this.config = {
      ...base,
      ...customConfig,
    };

    const domain = normalizeShopDomain(this.config.shop);
    const version = this.config.apiVersion || '2026-10';
    this.graphqlEndpoint = `https://${domain}/admin/api/${version}/graphql.json`;
  }

  /**
   * Executes a GraphQL query against Shopify Admin GraphQL API with automatic
   * token resolution, throttling management, and exponential backoff retry.
   */
  public async executeGraphQL<T>(
    query: string,
    variables: Record<string, unknown> = {},
    maxRetries = 5
  ): Promise<GraphQLResponse<T>> {
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < maxRetries) {
      attempt++;
      try {
        const token = await getAccessToken(this.config);

        const response = await fetch(this.graphqlEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': token,
            Accept: 'application/json',
          },
          body: JSON.stringify({ query, variables }),
        });

        // Handle HTTP Rate Limiting (429)
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTimeMs = retryAfter ? parseFloat(retryAfter) * 1000 : Math.pow(2, attempt) * 1000;
          console.warn(`[Shopify API] Rate limited (HTTP 429). Backing off for ${Math.round(waitTimeMs)}ms (attempt ${attempt}/${maxRetries})...`);
          await sleep(waitTimeMs);
          continue;
        }

        // Handle server side transient errors (500, 502, 503, 504)
        if (response.status >= 500) {
          const waitTimeMs = Math.pow(2, attempt) * 1000;
          console.warn(`[Shopify API] Server returned HTTP ${response.status}. Retrying in ${Math.round(waitTimeMs)}ms (attempt ${attempt}/${maxRetries})...`);
          await sleep(waitTimeMs);
          continue;
        }

        const rawText = await response.text();
        let jsonResponse: GraphQLResponse<T>;

        try {
          jsonResponse = JSON.parse(rawText);
        } catch {
          throw new Error(
            `Shopify GraphQL returned non-JSON response (HTTP ${response.status}): ${rawText.slice(0, 300)}`
          );
        }

        // Check if GraphQL response indicates throttling error
        if (jsonResponse.errors && jsonResponse.errors.some((e) => e.extensions?.code === 'THROTTLED')) {
          const waitTimeMs = Math.pow(2, attempt) * 1500;
          console.warn(`[Shopify API] GraphQL THROTTLED response. Backing off for ${Math.round(waitTimeMs)}ms...`);
          await sleep(waitTimeMs);
          continue;
        }

        // Inspect extensions.cost for rate limit self-regulation
        if (jsonResponse.extensions?.cost) {
          await this.handleCostThrottle(jsonResponse.extensions.cost);
        }

        return jsonResponse;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isNetworkError =
          lastError.message.includes('fetch failed') ||
          lastError.message.includes('ETIMEDOUT') ||
          lastError.message.includes('ECONNRESET');

        if (isNetworkError && attempt < maxRetries) {
          const waitTimeMs = Math.pow(2, attempt) * 1000;
          console.warn(`[Shopify API] Network issue (${lastError.message}). Retrying in ${Math.round(waitTimeMs)}ms...`);
          await sleep(waitTimeMs);
          continue;
        }

        throw new Error(
          sanitizeLog(lastError.message, [this.config.clientSecret, this.config.accessToken])
        );
      }
    }

    throw new Error(
      `Shopify GraphQL request failed after ${maxRetries} attempts: ${sanitizeLog(
        lastError?.message || 'Unknown error',
        [this.config.clientSecret, this.config.accessToken]
      )}`
    );
  }

  /**
   * Evaluates GraphQL cost extension and sleeps if available credit is getting low.
   */
  private async handleCostThrottle(cost: CostExtension): Promise<void> {
    const { requestedQueryCost, throttleStatus } = cost;
    if (!throttleStatus) return;

    const { currentlyAvailable, restoreRate } = throttleStatus;
    const buffer = 50; // Safety buffer to avoid 429 threshold

    if (currentlyAvailable < requestedQueryCost + buffer && restoreRate > 0) {
      const deficit = requestedQueryCost + buffer - currentlyAvailable;
      const sleepSeconds = Math.ceil(deficit / restoreRate);
      const sleepMs = Math.min(Math.max(sleepSeconds * 1000, 500), 10000);
      await sleep(sleepMs);
    }
  }

  /**
   * Tests the Shopify connection:
   * 1. Validates authentication token.
   * 2. Retrieves store name, myshopify domain, and primary domain.
   * 3. Confirms read_products permission with a minimal product read.
   */
  public async testConnection(): Promise<ConnectionTestResult> {
    const storeQuery = `
      query TestStoreConnection {
        shop {
          name
          myshopifyDomain
          primaryDomain {
            url
            host
          }
          plan {
            displayName
          }
        }
      }
    `;

    let shopResponse: GraphQLResponse<{
      shop: {
        name: string;
        myshopifyDomain: string;
        primaryDomain?: { url: string; host: string };
        plan?: { displayName: string };
      };
    }>;

    try {
      shopResponse = await this.executeGraphQL(storeQuery);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        productAccessGranted: false,
        message: `Connection failed: ${sanitizeLog(msg, [this.config.clientSecret, this.config.accessToken])}`,
      };
    }

    if (shopResponse.errors && shopResponse.errors.length > 0) {
      const errorMsg = shopResponse.errors.map((e) => e.message).join('; ');
      return {
        success: false,
        productAccessGranted: false,
        message: `Shopify GraphQL Error during store verification: ${errorMsg}`,
      };
    }

    const shop = shopResponse.data?.shop;
    if (!shop) {
      return {
        success: false,
        productAccessGranted: false,
        message: 'Shopify response succeeded but returned empty shop details.',
      };
    }

    // Step 2: Validate Product Access Scope (read_products)
    const productScopeCheck = `
      query CheckProductScope {
        products(first: 1) {
          edges {
            node {
              id
              title
            }
          }
        }
      }
    `;

    try {
      const productResponse = await this.executeGraphQL<{
        products: { edges: Array<{ node: { id: string; title: string } }> };
      }>(productScopeCheck);

      if (productResponse.errors && productResponse.errors.length > 0) {
        const errorMsg = productResponse.errors.map((e) => e.message).join('; ');
        const isPermissionError =
          errorMsg.toLowerCase().includes('access denied') ||
          errorMsg.toLowerCase().includes('scope') ||
          errorMsg.toLowerCase().includes('permission');

        return {
          success: true,
          shop: {
            name: shop.name,
            myshopifyDomain: shop.myshopifyDomain,
            primaryDomainUrl: shop.primaryDomain?.url,
            planDisplayName: shop.plan?.displayName,
          },
          productAccessGranted: false,
          message: isPermissionError
            ? `Store authenticated (${shop.name}), but product access is DENIED. Missing 'read_products' scope.\n` +
              'Please open Shopify Dev Dashboard -> Apps -> GenuDo Integration -> Versions -> Active version, add "read_products", release the version, and ensure the merchant has approved permissions.'
            : `Store authenticated (${shop.name}), but product check returned error: ${errorMsg}`,
        };
      }

      return {
        success: true,
        shop: {
          name: shop.name,
          myshopifyDomain: shop.myshopifyDomain,
          primaryDomainUrl: shop.primaryDomain?.url,
          planDisplayName: shop.plan?.displayName,
        },
        productAccessGranted: true,
        message: `Authentication successful! Connected to store "${shop.name}" (${shop.myshopifyDomain}). Product read access is verified.`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: true,
        shop: {
          name: shop.name,
          myshopifyDomain: shop.myshopifyDomain,
          primaryDomainUrl: shop.primaryDomain?.url,
          planDisplayName: shop.plan?.displayName,
        },
        productAccessGranted: false,
        message: `Store authenticated (${shop.name}), but failed product access verification: ${sanitizeLog(
          msg,
          [this.config.clientSecret, this.config.accessToken]
        )}`,
      };
    }
  }

  /**
   * Fetches all products with complete cursor-based pagination and full variant pagination.
   */
  public async fetchAllProducts(options: {
    limit?: number;
    activeOnly?: boolean;
    onProgress?: (progress: {
      page: number;
      fetchedProducts: number;
      message: string;
    }) => void;
  } = {}): Promise<RawProductNode[]> {
    const { limit, activeOnly = false, onProgress } = options;

    const queryFilter = activeOnly ? 'status:ACTIVE' : undefined;
    const pageSize = limit && limit < 50 ? limit : 50;

    const productsQuery = `
      query FetchCatalogPage($first: Int!, $after: String, $query: String) {
        products(first: $first, after: $after, query: $query) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            cursor
            node {
              id
              title
              handle
              description
              descriptionHtml
              vendor
              productType
              category {
                id
                name
              }
              tags
              status
              onlineStoreUrl
              featuredImage {
                url
                altText
              }
              images(first: 100) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                edges {
                  node {
                    url
                    altText
                    width
                    height
                  }
                }
              }
              variants(first: 100) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                edges {
                  node {
                    id
                    title
                    sku
                    price
                    compareAtPrice
                    inventoryQuantity
                    availableForSale
                    selectedOptions {
                      name
                      value
                    }
                    image {
                      url
                    }
                    createdAt
                    updatedAt
                  }
                }
              }
              createdAt
              updatedAt
            }
          }
        }
      }
    `;

    const allProducts: RawProductNode[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;
    let pageCount = 0;

    while (hasNextPage) {
      pageCount++;

      // Check if we already reached user-specified limit
      if (limit && allProducts.length >= limit) {
        break;
      }

      const remainingNeeded = limit ? limit - allProducts.length : pageSize;
      const currentBatchSize = Math.min(pageSize, remainingNeeded);

      onProgress?.({
        page: pageCount,
        fetchedProducts: allProducts.length,
        message: `Fetching product page ${pageCount} (cursor: ${cursor ? cursor.slice(-8) : 'start'})...`,
      });

      const response: GraphQLResponse<{
        products: {
          pageInfo: {
            hasNextPage: boolean;
            endCursor: string | null;
          };
          edges: Array<{
            cursor: string;
            node: RawProductNode;
          }>;
        };
      }> = await this.executeGraphQL(productsQuery, {
        first: currentBatchSize,
        after: cursor,
        query: queryFilter,
      });

      if (response.errors && response.errors.length > 0) {
        const errorMsg = response.errors.map((e) => e.message).join('; ');
        throw new Error(`Shopify GraphQL error while fetching products: ${errorMsg}`);
      }

      const productsData = response.data?.products;
      if (!productsData) {
        throw new Error('Shopify GraphQL returned empty data structure while paginating products.');
      }

      for (const edge of productsData.edges) {
        let productNode = edge.node;

        // Check if product has more than 100 variants
        if (productNode.variants.pageInfo.hasNextPage) {
          productNode = await this.fetchAllVariantsForProduct(productNode);
        }

        // Check if product has more than 100 images
        if (productNode.images.pageInfo.hasNextPage) {
          productNode = await this.fetchAllImagesForProduct(productNode);
        }

        allProducts.push(productNode);

        if (limit && allProducts.length >= limit) {
          break;
        }
      }

      hasNextPage = productsData.pageInfo.hasNextPage;
      cursor = productsData.pageInfo.endCursor;

      if (!cursor) {
        hasNextPage = false;
      }
    }

    onProgress?.({
      page: pageCount,
      fetchedProducts: allProducts.length,
      message: `Completed catalog retrieval. Total products fetched: ${allProducts.length}.`,
    });

    return allProducts;
  }

  /**
   * Paginates remaining variants for products with more than 100 variants.
   */
  private async fetchAllVariantsForProduct(product: RawProductNode): Promise<RawProductNode> {
    let hasNextPage = product.variants.pageInfo.hasNextPage;
    let cursor = product.variants.pageInfo.endCursor;
    const variantEdges = [...product.variants.edges];

    const variantsSubquery = `
      query FetchProductVariants($id: ID!, $after: String!) {
        product(id: $id) {
          variants(first: 100, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                title
                sku
                price
                compareAtPrice
                inventoryQuantity
                availableForSale
                selectedOptions {
                  name
                  value
                }
                image {
                  url
                }
                createdAt
                updatedAt
              }
            }
          }
        }
      }
    `;

    while (hasNextPage && cursor) {
      const response: GraphQLResponse<{
        product: {
          variants: {
            pageInfo: {
              hasNextPage: boolean;
              endCursor: string | null;
            };
            edges: Array<{
              node: RawVariantNode;
            }>;
          };
        };
      }> = await this.executeGraphQL(variantsSubquery, {
        id: product.id,
        after: cursor,
      });

      const nextVariants = response.data?.product?.variants;
      if (!nextVariants) break;

      variantEdges.push(...nextVariants.edges);
      hasNextPage = nextVariants.pageInfo.hasNextPage;
      cursor = nextVariants.pageInfo.endCursor;
    }

    return {
      ...product,
      variants: {
        pageInfo: {
          hasNextPage: false,
          endCursor: cursor,
        },
        edges: variantEdges,
      },
    };
  }

  /**
   * Paginates remaining images for products with more than 100 images.
   */
  private async fetchAllImagesForProduct(product: RawProductNode): Promise<RawProductNode> {
    let hasNextPage = product.images.pageInfo.hasNextPage;
    let cursor = product.images.pageInfo.endCursor;
    const imageEdges = [...product.images.edges];

    const imagesSubquery = `
      query FetchProductImages($id: ID!, $after: String!) {
        product(id: $id) {
          images(first: 100, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                url
                altText
                width
                height
              }
            }
          }
        }
      }
    `;

    while (hasNextPage && cursor) {
      const response: GraphQLResponse<{
        product: {
          images: {
            pageInfo: {
              hasNextPage: boolean;
              endCursor: string | null;
            };
            edges: Array<{
              node: RawImageNode;
            }>;
          };
        };
      }> = await this.executeGraphQL(imagesSubquery, {
        id: product.id,
        after: cursor,
      });

      const nextImages = response.data?.product?.images;
      if (!nextImages) break;

      imageEdges.push(...nextImages.edges);
      hasNextPage = nextImages.pageInfo.hasNextPage;
      cursor = nextImages.pageInfo.endCursor;
    }

    return {
      ...product,
      images: {
        pageInfo: {
          hasNextPage: false,
          endCursor: cursor,
        },
        edges: imageEdges,
      },
    };
  }
}
