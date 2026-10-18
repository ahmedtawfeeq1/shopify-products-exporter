#!/usr/bin/env node
import { ShopifyGraphQLClient } from './shopify.js';
import { exportCatalogData } from './export.js';
import { loadShopifyConfig } from './auth.js';

/**
 * Parses CLI command line arguments
 */
function parseArgs(args: string[]) {
  const command = args[0] || 'export:products';
  let limit: number | undefined;
  let activeOnly = false;
  let outputDir = './output';

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--limit' && args[i + 1]) {
      const parsed = parseInt(args[i + 1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        limit = parsed;
      }
      i++;
    } else if (arg.startsWith('--limit=')) {
      const parsed = parseInt(arg.split('=')[1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        limit = parsed;
      }
    } else if (arg === '--active-only') {
      activeOnly = true;
    } else if (arg === '--output-dir' && args[i + 1]) {
      outputDir = args[i + 1];
      i++;
    } else if (arg.startsWith('--output-dir=')) {
      outputDir = arg.split('=')[1];
    }
  }

  return {
    command,
    limit,
    activeOnly,
    outputDir,
  };
}

/**
 * Executes test:connection command
 */
async function runTestConnection(): Promise<void> {
  console.log('====================================================');
  console.log('        Shopify Connection & Scope Verification    ');
  console.log('====================================================');
  console.log('Connecting to Shopify...');

  const config = loadShopifyConfig();
  console.log(`Target Shop:   ${config.shop || '(not set)'}`);
  console.log(`API Version:   ${config.apiVersion}`);
  console.log(
    `Auth Mode:     ${
      config.accessToken
        ? 'Mode 2: Access Token'
        : config.clientId && config.clientSecret
        ? 'Mode 1: Client Credentials Grant'
        : 'None configured'
    }`
  );
  console.log('----------------------------------------------------');

  const client = new ShopifyGraphQLClient();
  const result = await client.testConnection();

  if (result.success && result.productAccessGranted && result.shop) {
    console.log('Authentication successful.');
    console.log(`Store Name:       ${result.shop.name}`);
    console.log(`Shopify Domain:   ${result.shop.myshopifyDomain}`);
    if (result.shop.primaryDomainUrl) {
      console.log(`Primary Domain:   ${result.shop.primaryDomainUrl}`);
    }
    if (result.shop.planDisplayName) {
      console.log(`Plan:             ${result.shop.planDisplayName}`);
    }
    console.log(`Product Access:   GRANTED (read_products verified)`);
    console.log('\nResult: READY TO EXPORT CATALOG');
    console.log('Run "npm run export:products" to begin exporting.\n');
  } else {
    console.error('\nCONNECTION / PERMISSION ERROR:');
    console.error(result.message);
    process.exit(1);
  }
}

/**
 * Executes export:products command
 */
async function runExportProducts(options: {
  limit?: number;
  activeOnly?: boolean;
  outputDir?: string;
}): Promise<void> {
  const startTimeMs = Date.now();

  console.log('====================================================');
  console.log('             Shopify Product Catalog Exporter       ');
  console.log('====================================================');
  if (options.limit) {
    console.log(`Limit:         Exporting maximum ${options.limit} products`);
  }
  if (options.activeOnly) {
    console.log('Filter:        Active products only (status:ACTIVE)');
  }
  console.log(`Output Folder: ${options.outputDir}`);
  console.log('----------------------------------------------------');

  console.log('Connecting to Shopify...');
  const client = new ShopifyGraphQLClient();

  // Quick initial check to ensure connection is healthy before starting bulk pagination
  const check = await client.testConnection();
  if (!check.success || !check.productAccessGranted) {
    console.error('\nError: Unable to authenticate or access products:');
    console.error(check.message);
    process.exit(1);
  }

  console.log(`Authentication successful. Store: ${check.shop?.name} (${check.shop?.myshopifyDomain})`);
  console.log('Fetching products...');

  const rawProducts = await client.fetchAllProducts({
    limit: options.limit,
    activeOnly: options.activeOnly,
    onProgress: (p) => {
      console.log(`[Progress] ${p.message}`);
    },
  });

  console.log(`Fetched ${rawProducts.length} products.`);
  console.log('Fetching variants and cleaning descriptions...');
  console.log('Writing CSV...');
  console.log('Writing JSON...');

  const summary = await exportCatalogData(rawProducts, options.outputDir, startTimeMs);

  console.log('Export complete.');
  console.log('====================================================');
  console.log('                 EXPORT SUMMARY                     ');
  console.log('====================================================');
  console.log(`Total Products:            ${summary.totalProducts}`);
  console.log(`Total Variants:            ${summary.totalVariants}`);
  console.log(`Products CSV Rows:         ${summary.productsCsvRows}`);
  console.log(`Variants CSV Rows:         ${summary.variantsCsvRows}`);
  console.log(`Malformed Encoding Items:  ${summary.malformedEncodingCount}`);
  console.log(`Duration:                  ${summary.durationSeconds}s`);
  console.log('----------------------------------------------------');
  console.log('Exported files:');
  console.log(`  1. JSON:         ${summary.jsonFilePath}`);
  console.log(`  2. Products CSV: ${summary.productsCsvFilePath}`);
  console.log(`  3. Variants CSV: ${summary.variantsCsvFilePath}`);
  console.log('====================================================\n');
}

/**
 * Main CLI router
 */
async function main() {
  const rawArgs = process.argv.slice(2);
  const { command, limit, activeOnly, outputDir } = parseArgs(rawArgs);

  try {
    if (command === 'test:connection') {
      await runTestConnection();
    } else if (command === 'export:products') {
      await runExportProducts({ limit, activeOnly, outputDir });
    } else {
      console.log(`Unknown command: ${command}`);
      console.log('Available commands:');
      console.log('  npm run test:connection');
      console.log('  npm run export:products [-- --limit=50] [--active-only]');
      process.exit(1);
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('\nExecution failed:');
    console.error(errorMsg);
    process.exit(1);
  }
}

main();
