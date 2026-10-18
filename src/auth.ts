import dotenv from 'dotenv';
import { ShopifyConfig, AuthTokenResponse, CachedToken } from './types.js';

dotenv.config();

/**
 * In-memory token cache to prevent requesting tokens on every single query
 */
let memoryTokenCache: CachedToken | null = null;

/**
 * Resets the in-memory token cache (useful for testing)
 */
export function resetTokenCache(): void {
  memoryTokenCache = null;
}

/**
 * Sanitizes messages or error strings to ensure secrets and access tokens are NEVER leaked.
 */
export function sanitizeLog(message: string, secrets: Array<string | undefined>): string {
  let sanitized = message;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      sanitized = sanitized.replaceAll(secret, '***REDACTED***');
    }
  }
  // Generic pattern for Shopify tokens (shpat_..., shpca_..., etc.)
  sanitized = sanitized.replace(/shp[a-z]{2}_[a-zA-Z0-9_-]{16,}/g, '***REDACTED_SHOPIFY_TOKEN***');
  return sanitized;
}

/**
 * Validates and extracts Shopify configuration from environment variables.
 */
export function loadShopifyConfig(): ShopifyConfig {
  const shop = process.env.SHOPIFY_SHOP?.trim() || '';
  const apiVersion = process.env.SHOPIFY_API_VERSION?.trim() || '2026-10';
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN?.trim();

  return {
    shop,
    apiVersion,
    clientId,
    clientSecret,
    accessToken,
  };
}

/**
 * Normalizes shop domain to hostname (removes https://, trailing slashes, etc.)
 */
export function normalizeShopDomain(rawShop: string): string {
  let cleaned = rawShop.trim();
  cleaned = cleaned.replace(/^https?:\/\//i, '');
  cleaned = cleaned.replace(/\/+$/, '');
  return cleaned;
}

/**
 * Obtains an access token using Client Credentials Grant or returns an existing configured access token.
 * Caches tokens in-memory according to Shopify's expires_in response.
 */
export async function getAccessToken(config?: ShopifyConfig): Promise<string> {
  const currentConfig = config || loadShopifyConfig();

  // Mode 2: Existing Admin API Access Token
  if (currentConfig.accessToken) {
    return currentConfig.accessToken;
  }

  // Check if we have a valid non-expired cached token
  const now = Date.now();
  if (memoryTokenCache && memoryTokenCache.expiresAt > now + 60 * 1000) {
    return memoryTokenCache.token;
  }

  // Mode 1: Client Credentials Grant
  const { shop, clientId, clientSecret } = currentConfig;

  if (!shop) {
    throw new Error(
      'Missing SHOPIFY_SHOP in environment. Please provide your permanent Shopify domain (e.g. yourstore.myshopify.com) in .env.'
    );
  }

  if (!clientId || !clientSecret) {
    throw new Error(
      'No valid Shopify authentication credentials found.\n' +
        'Please configure either:\n' +
        '  Mode 1 (Client Credentials): SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET\n' +
        '  Mode 2 (Access Token): SHOPIFY_ACCESS_TOKEN\n' +
        'Check your .env file or refer to README.md for setup instructions.'
    );
  }

  const normalizedDomain = normalizeShopDomain(shop);
  const tokenEndpoint = `https://${normalizedDomain}/admin/oauth/access_token`;

  const bodyParams = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  let response: Response;
  try {
    response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: bodyParams.toString(),
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to connect to Shopify token endpoint (${tokenEndpoint}): ${sanitizeLog(errorMsg, [
        clientSecret,
        clientId,
      ])}`
    );
  }

  const responseText = await response.text();
  let data: AuthTokenResponse;

  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(
      `Shopify token endpoint returned non-JSON response (HTTP ${response.status}): ${sanitizeLog(
        responseText.slice(0, 300),
        [clientSecret, clientId]
      )}`
    );
  }

  if (!response.ok || !data.access_token) {
    const errorDetail = JSON.stringify(data);
    const sanitizedDetail = sanitizeLog(errorDetail, [clientSecret, clientId]);

    if (response.status === 400 || response.status === 401) {
      throw new Error(
        `Shopify Client Credentials Grant failed (HTTP ${response.status}): ${sanitizedDetail}\n` +
          'Important troubleshooting tips:\n' +
          '1. The Client Credentials Grant requires that the Shopify App and the Store belong to the SAME Shopify Organization.\n' +
          '2. Verify that the Client ID and Client Secret in .env match the credentials under Dev Dashboard -> Apps -> GenuDo Integration -> App Settings -> Credentials.\n' +
          '3. If the app is owned by a different partner organization, you must generate and use a standard SHOPIFY_ACCESS_TOKEN instead.'
      );
    }

    throw new Error(
      `Shopify authentication request failed with HTTP ${response.status}: ${sanitizedDetail}`
    );
  }

  // Calculate expiration time based on Shopify's returned expires_in (seconds)
  // Default to 24 hours (86400s) if not provided by response
  const expiresInSeconds = typeof data.expires_in === 'number' ? data.expires_in : 86400;
  // Subtract buffer (60s) to renew before hard expiration
  const bufferSeconds = Math.min(60, Math.floor(expiresInSeconds / 10));
  const expiresAt = now + (expiresInSeconds - bufferSeconds) * 1000;

  memoryTokenCache = {
    token: data.access_token,
    expiresAt,
    scope: data.scope || '',
  };

  return memoryTokenCache.token;
}
