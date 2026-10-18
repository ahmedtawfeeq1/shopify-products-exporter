/**
 * Type definitions for the Shopify Product Exporter
 */

export interface ShopifyConfig {
  shop: string;
  apiVersion: string;
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
}

export interface AuthTokenResponse {
  access_token: string;
  scope: string;
  expires_in?: number;
  associated_user_scope?: string;
  associated_user?: Record<string, unknown>;
}

export interface CachedToken {
  token: string;
  expiresAt: number; // Unix timestamp in ms
  scope: string;
}

export interface ShopInfo {
  name: string;
  myshopifyDomain: string;
  primaryDomainUrl?: string;
  planDisplayName?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  shop?: ShopInfo;
  productAccessGranted: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface ThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

export interface CostExtension {
  requestedQueryCost: number;
  actualQueryCost?: number;
  throttleStatus: ThrottleStatus;
}

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
    extensions?: Record<string, unknown>;
  }>;
  extensions?: {
    cost?: CostExtension;
  };
}

export interface RawSelectedOption {
  name: string;
  value: string;
}

export interface RawImageNode {
  url: string;
  altText: string | null;
  width?: number | null;
  height?: number | null;
}

export interface RawVariantNode {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  availableForSale: boolean;
  selectedOptions: RawSelectedOption[];
  image: {
    url: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface RawProductNode {
  id: string;
  title: string;
  handle: string;
  description: string;
  descriptionHtml?: string;
  vendor: string;
  productType: string;
  category?: {
    id: string;
    name: string;
  } | null;
  tags: string[];
  status: string;
  onlineStoreUrl: string | null;
  featuredImage: {
    url: string;
    altText: string | null;
  } | null;
  images: {
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
    edges: Array<{
      node: RawImageNode;
    }>;
  };
  variants: {
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
    edges: Array<{
      node: RawVariantNode;
    }>;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CleanTextResult {
  text: string;
  isMalformed: boolean;
  malformedReasons: string[];
}

export interface NormalizedVariant {
  shopify_variant_id: string;
  numeric_variant_id: string;
  shopify_product_id: string;
  product_title: string;
  product_handle: string;
  variant_title: string;
  sku: string;
  price: number;
  compare_at_price: number | null;
  inventory_quantity: number | null;
  available_for_sale: boolean;
  selected_options: Record<string, string>;
  selected_options_summary: string;
  variant_image_url: string;
  created_at: string;
  updated_at: string;
}

export interface NormalizedProduct {
  shopify_product_id: string;
  numeric_product_id: string;
  title: string;
  handle: string;
  description: string;
  vendor: string;
  product_type: string;
  category: string;
  tags: string[];
  tags_formatted: string;
  status: string;
  product_url: string;
  featured_image_url: string;
  media_image_urls: string[];
  created_at: string;
  updated_at: string;
  variant_count: number;
  has_malformed_encoding: boolean;
  variants: NormalizedVariant[];
}

export interface ExportOptions {
  limit?: number;
  activeOnly?: boolean;
  outputDir?: string;
}

export interface ExportSummary {
  totalProducts: number;
  totalVariants: number;
  malformedEncodingCount: number;
  jsonFilePath: string;
  productsCsvFilePath: string;
  variantsCsvFilePath: string;
  productsCsvRows: number;
  variantsCsvRows: number;
  durationSeconds: number;
}
