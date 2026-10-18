# Shopify Products Exporter & AI Sales Knowledge Base Generator

A high-performance, strictly read-only TypeScript & Python utility designed to extract complete Shopify product catalogs and transform them into structured, clean data for AI sales agents, conversational commerce, and analytics.

Designed for direct integration into **MCP (Model Context Protocol) plugins**, AI agent workflows (WhatsApp, Instagram, Messenger), and knowledge table vector embeddings.

---

## Key Features

1. **Dual Authentication Modes**:
   - **Mode 1 (Client Credentials Grant)**: Automatically requests and caches short-lived OAuth access tokens using merchant-owned Shopify app credentials (`client_id` + `client_secret`).
   - **Mode 2 (Offline Access Token)**: Connects using pre-existing `SHOPIFY_ACCESS_TOKEN` (e.g., `shpat_...`).
2. **Strictly Read-Only & Secure**:
   - Zero Shopify mutations; no write scopes requested or used.
   - Zero credential or token leakage in logs, console output, or error traces.
   - All exported data remains strictly on your local filesystem.
3. **Clean Description Normalization**:
   - Extracts Shopify's native plain-text `description` field without raw HTML tags (`<p>`, `<span>`, `<strong>`, `<ul>`, `<li>`, `<br>`).
   - Translates block elements into clean paragraph breaks while collapsing excessive whitespace.
   - Preserves Arabic and English characters, measurements, numbers, dimensions, and punctuation.
   - Detects malformed UTF-8 byte sequences or replacement characters (`\uFFFD`) and reports them in the audit summary.
4. **Complete Catalog & Variant Pagination**:
   - Cursor-based GraphQL pagination across all products.
   - Sub-paginates variants for products with more than 100 variants so no SKU is truncated.
   - Sub-paginates product media images.
5. **Formatted AI Knowledge Base Spreadsheets**:
   - Outputs a ready-to-use formatted Excel workbook (`.xlsx`) and companion UTF-8 BOM CSV.
   - **Automatic Arabic Localization**: Automatically translates English-only titles into natural Arabic e-commerce titles, highlighting them in soft yellow for merchant review.
   - **Intelligent Option Mapping**: Clearly separates single standalone products from true multi-variant products (color/size/shape), eliminating confusing internal Shopify placeholders like `Default Title`.
   - **Full Text Wrapping & Spacious Columns**: Configured with explicit `wrap_text=True` across every cell so URLs and long text never overflow into neighboring cells.
   - **Formula Injection Defense**: Escapes cells starting with dangerous trigger characters (`=`, `+`, `-`, `@`, `\t`, `\r`) with a single apostrophe `'`.
6. **API Throttling & Self-Regulation**:
   - Inspects Shopify GraphQL `extensions.cost` and automatically pauses if credits run low.
   - Automatic exponential backoff retry for HTTP 429 and transient network failures.

---

## Project Structure

```text
shopify-products-exporter/
├── src/
│   ├── types.ts          # TypeScript interfaces for Shopify GraphQL & normalized models
│   ├── auth.ts           # Dual auth: Client Credentials Grant (with token caching) & Access Token
│   ├── cleaner.ts        # Description HTML stripping, whitespace normalizer, UTF-8 checks
│   ├── shopify.ts        # Admin GraphQL client, cost regulation, sub-pagination
│   ├── export.ts         # Catalog normalizer, CSV writer with BOM & formula injection defense
│   ├── cli.ts            # CLI command runner for test:connection and export:products
│   ├── index.ts          # Programmatic API export for MCP tools & connector services
│   └── __tests__/        # Automated unit test suite (25 tests passing)
│       ├── auth.test.ts
│       ├── cleaner.test.ts
│       ├── export.test.ts
│       └── shopify.test.ts
├── scripts/
│   ├── generate_active_excel.py  # Generates styled active-only Excel with Arabic localization
│   └── generate_excel.py         # Generates complete catalog Excel
├── output/                       # Default export destination (git-ignored)
│   └── .gitkeep
├── .env.example                  # Environment variable template
├── .gitignore                    # Ignores .env, output/*, scratch/, node_modules
├── package.json
├── tsconfig.json
└── README.md
```

---

## Setup & Configuration

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy the template:
```bash
cp .env.example .env
```

Edit `.env` with your store credentials:

```env
# Permanent Shopify store domain
SHOPIFY_SHOP=your-store.myshopify.com

# Shopify Admin API Version (default: 2026-10)
SHOPIFY_API_VERSION=2026-10

# ------------------------------------------------------------------------------
# MODE 1: Client Credentials Grant (Same Shopify Organization)
# Recommended when using an app created in the merchant's Shopify Organization
# ------------------------------------------------------------------------------
SHOPIFY_CLIENT_ID=your_client_id_here
SHOPIFY_CLIENT_SECRET=your_client_secret_here

# ------------------------------------------------------------------------------
# MODE 2: Existing Admin API Access Token (Optional Alternative)
# If using a custom app or an OAuth token (starts with shpat_...)
# ------------------------------------------------------------------------------
# SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxx
```

---

## Usage Commands

### 1. Test Connection & Permissions
Validate authentication, store metadata, and confirm the `read_products` permission:
```bash
npm run test:connection
```

### 2. Export Products (Raw Catalog)
Retrieve the entire product catalog via GraphQL cursor pagination:
```bash
npm run export:products
```

Optional flags:
```bash
# Limit number of products (useful for quick testing)
npm run export:products -- --limit=10

# Export only active products
npm run export:products -- --active-only

# Custom output destination
npm run export:products -- --output-dir=./custom_output
```

### 3. Generate Formatted AI Sales Knowledge Base
Generate formatted Excel spreadsheets (`.xlsx`) and companion CSVs with intelligent option mapping and Arabic localization:

```bash
# Generate Knowledge Base for ACTIVE (live) products only
npm run export:excel:active

# Generate Knowledge Base for the full catalog (including drafts)
npm run export:excel
```

---

## Knowledge Base Schema

The active knowledge base spreadsheet formats data specifically for AI agents:

| Column Header | Description | Example |
| :--- | :--- | :--- |
| **`default_id`** | Unique stable ID for vector upserts | `prod-7913106440262` |
| **`product_name`** | Original product title | `Wooden Shape Matching Speed Challenge` |
| **`arabic_title`** | Native or auto-translated Arabic title *(Yellow if auto-translated)* | `تحدي سرعة مطابقة الأشكال الخشبية` |
| **`target_age`** | Age suitability for query filtering | `3-6 years; 6-9 Years` |
| **`category_and_tags`** | Category & tags combined | `Category: Educational Toys \| Tags: 3-6 years` |
| **`stock_status`** | Color-coded availability badge | `IN_STOCK (16 units)` *(Green)* or `OUT_OF_STOCK` *(Red)* |
| **`price_range`** | Price or pricing range | `375.00 SAR` |
| **`discount_info`** | Promotional discount details | `Regular Price` *(or `Was 450 SAR (Save 75 SAR)`)* |
| **`description`** | Clean sales copy without HTML | Cleaned description text |
| **`variants_summary`** | Clean options & SKU | `No Options (Standard Item) \| SKU: EDU-GEN-158` |
| **`image_url`** | Product photo for media messaging | `https://cdn.shopify.com/.../image.jpg` |
| **`product_url`** | Storefront checkout URL | `https://your-store.com/products/...` |

---

## Testing

Run unit tests via Vitest:
```bash
npm test
```

Type-checking:
```bash
npm run typecheck
```

---

## License

MIT License
