import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getAccessToken,
  resetTokenCache,
  sanitizeLog,
  normalizeShopDomain,
} from '../auth.js';

describe('Shopify Authentication & Token Management', () => {
  beforeEach(() => {
    resetTokenCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes shop domain by stripping protocols and slashes', () => {
    expect(normalizeShopDomain('https://example.myshopify.com/')).toBe('example.myshopify.com');
    expect(normalizeShopDomain('http://store.myshopify.com///')).toBe('store.myshopify.com');
    expect(normalizeShopDomain('store.myshopify.com')).toBe('store.myshopify.com');
  });

  it('sanitizes secrets and tokens so they never appear in logs', () => {
    const secret = 'super_secret_client_key_12345';
    const token = 'shp' + 'at_dummy_token_example_for_unit_tests';
    const log = `Error connecting with secret ${secret} and token ${token}`;

    const sanitized = sanitizeLog(log, [secret]);
    expect(sanitized).not.toContain(secret);
    expect(sanitized).not.toContain(token);
    expect(sanitized).toContain('***REDACTED***');
    expect(sanitized).toContain('***REDACTED_SHOPIFY_TOKEN***');
  });

  it('returns existing access token in Mode 2 without hitting OAuth endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const token = await getAccessToken({
      shop: 'test.myshopify.com',
      apiVersion: '2026-10',
      accessToken: 'custom_pre_authenticated_token',
    });

    expect(token).toBe('custom_pre_authenticated_token');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws an error if no credentials or tokens are provided', async () => {
    await expect(
      getAccessToken({
        shop: '',
        apiVersion: '2026-10',
      })
    ).rejects.toThrow('Missing SHOPIFY_SHOP');

    await expect(
      getAccessToken({
        shop: 'test.myshopify.com',
        apiVersion: '2026-10',
      })
    ).rejects.toThrow('No valid Shopify authentication credentials found');
  });

  it('requests and caches access token using Client Credentials Grant', async () => {
    const mockToken = 'mock_client_credential_access_token_123';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: mockToken,
          scope: 'read_products,read_inventory',
          expires_in: 86400,
        }),
    } as unknown as Response);

    const config = {
      shop: 'test.myshopify.com',
      apiVersion: '2026-10',
      clientId: 'my_client_id',
      clientSecret: 'my_client_secret',
    };

    // First call: requests token from Shopify
    const token1 = await getAccessToken(config);
    expect(token1).toBe(mockToken);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call: retrieves from in-memory cache without repeating HTTP call
    const token2 = await getAccessToken(config);
    expect(token2).toBe(mockToken);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('provides actionable guidance on 401 / organization mismatch in Client Credentials Grant', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () =>
        JSON.stringify({
          error: 'invalid_client',
          error_description: 'Client does not have access to this store.',
        }),
    } as unknown as Response);

    const config = {
      shop: 'test.myshopify.com',
      apiVersion: '2026-10',
      clientId: 'my_client_id',
      clientSecret: 'my_client_secret',
    };

    await expect(getAccessToken(config)).rejects.toThrow(
      'Client Credentials Grant requires that the Shopify App and the Store belong to the SAME Shopify Organization'
    );
  });
});
