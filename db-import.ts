import * as fs from 'fs';
import * as path from 'path';
import sql from 'mssql';

const DB_CONFIG: sql.config = {
  user: 'warehouse',
  password: 'WitD1lW83V9R',
  server: '207.148.80.25',
  port: 1433,
  database: 'matthewsliquor_airflow',
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
  requestTimeout: 120000,
};

const SCHEMA = 'competitor_pricing';

const DDL = `
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = '${SCHEMA}')
  EXEC('CREATE SCHEMA ${SCHEMA}');
`;

const TABLES: Record<string, string> = {
  bws_products: `
    CREATE TABLE ${SCHEMA}.bws_products (
      crawl_date        DATE           NOT NULL,
      stockcode         NVARCHAR(20)   NOT NULL,
      name              NVARCHAR(300)  NOT NULL,
      brand             NVARCHAR(150),
      category          NVARCHAR(100),
      package_size      NVARCHAR(50),
      pack_qty          INT,
      price             DECIMAL(10,2)  NOT NULL,
      was_price         DECIMAL(10,2),
      savings           DECIMAL(10,2),
      is_on_special     BIT,
      is_member_special BIT,
      is_available      BIT,
      stock_on_hand     INT,
      rating            DECIMAL(3,2),
      review_count      INT,
      product_url       NVARCHAR(500),
      image_file        NVARCHAR(200),
      alcohol_pct       DECIMAL(4,1),
      country           NVARCHAR(100),
      liquor_style      NVARCHAR(100),
      varietal          NVARCHAR(100),
      vintage           NVARCHAR(100),
      PRIMARY KEY (crawl_date, stockcode)
    )`,
  danmurphys_products: `
    CREATE TABLE ${SCHEMA}.danmurphys_products (
      crawl_date        DATE           NOT NULL,
      stockcode         NVARCHAR(50)   NOT NULL,
      name              NVARCHAR(300)  NOT NULL,
      brand             NVARCHAR(150),
      category          NVARCHAR(100),
      package_size      NVARCHAR(50),
      price_single      DECIMAL(10,2)  NOT NULL,
      price_unit_label  NVARCHAR(50),
      price_case        DECIMAL(10,2),
      case_label        NVARCHAR(50),
      price_in_any_six  DECIMAL(10,2),
      promo_price       DECIMAL(10,2),
      promo_was_price   DECIMAL(10,2),
      promo_type        NVARCHAR(50),
      is_member_offer   BIT,
      is_on_special     BIT,
      is_purchasable    BIT,
      stock_on_hand     INT,
      rating            DECIMAL(3,2),
      review_count      INT,
      product_url       NVARCHAR(500),
      image_url         NVARCHAR(500),
      alcohol_pct       DECIMAL(4,1),
      country           NVARCHAR(100),
      varietal          NVARCHAR(100),
      vintage           NVARCHAR(100),
      PRIMARY KEY (crawl_date, stockcode)
    )`,
  liquorland_products: `
    CREATE TABLE ${SCHEMA}.liquorland_products (
      crawl_date        DATE           NOT NULL,
      product_id        NVARCHAR(20)   NOT NULL,
      name              NVARCHAR(300)  NOT NULL,
      brand             NVARCHAR(150),
      category          NVARCHAR(100),
      volume_ml         INT,
      packaging         NVARCHAR(50),
      pack_label        NVARCHAR(50),
      price             DECIMAL(10,2)  NOT NULL,
      normal_price      DECIMAL(10,2),
      price_per_six     DECIMAL(10,2),
      member_price      DECIMAL(10,2),
      promo_text        NVARCHAR(200),
      is_available      BIT,
      stock_status      NVARCHAR(50),
      rating            DECIMAL(3,2),
      review_count      INT,
      product_url       NVARCHAR(500),
      image_url         NVARCHAR(500),
      is_bundle         BIT,
      PRIMARY KEY (crawl_date, product_id)
    )`,
  firstchoice_products: `
    CREATE TABLE ${SCHEMA}.firstchoice_products (
      crawl_date        DATE           NOT NULL,
      product_id        NVARCHAR(20)   NOT NULL,
      name              NVARCHAR(300)  NOT NULL,
      brand             NVARCHAR(150),
      category          NVARCHAR(100),
      volume_ml         INT,
      packaging         NVARCHAR(50),
      pack_label        NVARCHAR(50),
      price             DECIMAL(10,2)  NOT NULL,
      normal_price      DECIMAL(10,2),
      price_per_six     DECIMAL(10,2),
      member_price      DECIMAL(10,2),
      promo_text        NVARCHAR(200),
      is_available      BIT,
      stock_status      NVARCHAR(50),
      rating            DECIMAL(3,2),
      review_count      INT,
      product_url       NVARCHAR(500),
      image_url         NVARCHAR(500),
      is_bundle         BIT,
      PRIMARY KEY (crawl_date, product_id)
    )`,
};

// site outputDir -> table + parser
const SITE_TABLE: Record<string, string> = {
  'bws.com.au': 'bws_products',
  'danmurphys.com.au': 'danmurphys_products',
  'liquorland.com.au': 'liquorland_products',
  'firstchoice.com.au': 'firstchoice_products',
};

function walkJsonFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsonFiles(p));
    else if (entry.name.endsWith('.json')) out.push(p);
  }
  return out;
}

const cleanText = (s: unknown): string | null => {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
};
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace('%', ''));
  return Number.isFinite(n) ? n : null;
};
const truncate = (s: string | null, max: number) => (s && s.length > max ? s.slice(0, max) : s);

function additionalDetailsMap(p: any): Record<string, string> {
  const map: Record<string, string> = {};
  for (const d of p.AdditionalDetails || []) {
    if (d?.Name && d.Value !== null && d.Value !== undefined && d.Value !== '') map[d.Name] = String(d.Value);
  }
  return map;
}

// category from file path relative to the site dir, e.g. wine/red-wine
function categoryFromPath(siteDir: string, file: string): string {
  const rel = path.relative(siteDir, path.dirname(file)).replace(/\\/g, '/');
  return rel.replace(/\/all$/, '') || '(root)';
}

function parseBws(siteDir: string, files: string[]): any[] {
  const rows = new Map<string, any>();
  for (const f of files) {
    let j: any;
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    if (!Array.isArray(j?.Bundles)) continue; // skips SponsoredAds responses
    const category = categoryFromPath(siteDir, f);
    for (const b of j.Bundles) for (const p of b.Products || []) {
      const stockcode = p.Stockcode !== null && p.Stockcode !== undefined ? String(p.Stockcode) : null;
      const price = num(p.Price);
      const name = cleanText(p.Name);
      if (!stockcode || price === null || !name || rows.has(stockcode)) continue;
      const ad = additionalDetailsMap(p);
      rows.set(stockcode, {
        stockcode,
        name: truncate(name, 300),
        brand: truncate(cleanText(p.BrandName), 150),
        category: truncate(category, 100),
        package_size: truncate(cleanText(p.PackageSize), 50),
        pack_qty: num(ad['productunitquantity']),
        price,
        was_price: num(p.WasPrice),
        savings: num(p.SavingsAmount),
        is_on_special: p.IsOnSpecial ?? null,
        is_member_special: p.IsEdrSpecial ?? null,
        is_available: p.IsAvailable ?? null,
        stock_on_hand: num(p.StockOnHand),
        rating: num(p.OverallRating),
        review_count: num(p.NumberOfReviews),
        product_url: p.UrlFriendlyName ? truncate(`https://bws.com.au/product/${stockcode}/${p.UrlFriendlyName}`, 500) : null,
        image_file: truncate(cleanText(ad['image1']), 200),
        alcohol_pct: num(ad['alcohol%']),
        country: truncate(cleanText(ad['countryoforigin']), 100),
        liquor_style: truncate(cleanText(ad['liquorstyle']), 100),
        varietal: truncate(cleanText(ad['varietal']), 100),
        vintage: truncate(cleanText(ad['vintage']), 100),
      });
    }
  }
  return [...rows.values()];
}

function parseDanMurphys(siteDir: string, files: string[]): any[] {
  const rows = new Map<string, any>();
  for (const f of files) {
    let j: any;
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    if (!Array.isArray(j?.Bundles)) continue;
    const category = categoryFromPath(siteDir, f);
    for (const b of j.Bundles) for (const p of b.Products || []) {
      const stockcode = p.Stockcode !== null && p.Stockcode !== undefined ? String(p.Stockcode) : null;
      const prices = p.Prices || {};
      const single = prices.singleprice;
      const name = cleanText(b.Name) || cleanText(p.Description);
      if (!stockcode || !single || single.Value === null || !name || rows.has(stockcode)) continue;
      const ad = additionalDetailsMap(p);
      const promo = prices.promoprice;
      rows.set(stockcode, {
        stockcode,
        name: truncate(name, 300),
        brand: truncate(cleanText(ad['webbrandname']), 150),
        category: truncate(category, 100),
        package_size: truncate(cleanText(p.PackageSize), 50),
        price_single: num(single.Value),
        price_unit_label: truncate(cleanText(single.Message), 50),
        price_case: num(prices.caseprice?.Value),
        case_label: truncate(cleanText(prices.caseprice?.Message), 50),
        price_in_any_six: num(prices.inanysixprice?.Value),
        promo_price: num(promo?.AfterPromotion ?? promo?.Value),
        promo_was_price: num(promo?.BeforePromotion),
        promo_type: truncate(cleanText(promo?.PromotionType), 50),
        is_member_offer: promo?.IsMemberOffer ?? null,
        is_on_special: p.IsOnSpecial ?? null,
        is_purchasable: p.IsPurchasable ?? null,
        stock_on_hand: num(p.StockOnHand),
        rating: num(ad['webaverageproductrating']),
        review_count: num(ad['webtotalreviewcount']),
        product_url: p.UrlFriendlyName ? truncate(`https://www.danmurphys.com.au/product/DM_${stockcode}/${p.UrlFriendlyName}`, 500) : null,
        image_url: truncate(cleanText(p.LargeImageFile), 500),
        alcohol_pct: num(ad['webalcoholpercentage']),
        country: truncate(cleanText(ad['webcountryoforigin'] || ad['countryoforigin']), 100),
        varietal: truncate(cleanText(ad['varietal']), 100),
        vintage: truncate(cleanText(ad['webvintagecurrent']), 100),
      });
    }
  }
  return [...rows.values()];
}

function parseColes(siteDir: string, files: string[], baseUrl: string): any[] {
  const rows = new Map<string, any>();
  for (const f of files) {
    let j: any;
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    if (!Array.isArray(j?.products)) continue;
    for (const p of j.products) {
      const id = p.id !== null && p.id !== undefined ? String(p.id) : null;
      const price = num(p.price?.current);
      const name = cleanText(p.name);
      if (!id || price === null || !name || p.isSponsoredProduct || rows.has(id)) continue;
      rows.set(id, {
        product_id: id,
        name: truncate(name, 300),
        brand: truncate(cleanText(p.brand), 150),
        category: truncate(cleanText(p.category), 100),
        volume_ml: num(p.volumeMl),
        packaging: truncate(cleanText(p.packaging), 50),
        pack_label: truncate(cleanText(p.unitOfMeasureLabel), 50),
        price,
        normal_price: num(p.price?.normal),
        price_per_six: num(p.price?.acrossAnySix) || null,
        member_price: num(p.price?.memberOnlyPrice) || null,
        promo_text: truncate(cleanText(p.promotion?.calloutText), 200),
        is_available: p.isAvailable ?? null,
        stock_status: truncate(cleanText(p.stock?.delivery), 50),
        rating: p.ratings?.average != null ? Math.round(p.ratings.average * 100) / 100 : null,
        review_count: num(p.ratings?.total),
        product_url: p.productUrl ? truncate(baseUrl + p.productUrl, 500) : null,
        image_url: truncate(cleanText(p.image?.heroImage), 500),
        is_bundle: p.isBundle ?? null,
      });
    }
  }
  return [...rows.values()];
}

function tableColumns(table: string): [string, any][] {
  const decimal = (p: number, s: number) => sql.Decimal(p, s);
  const common: Record<string, [string, any][]> = {
    bws_products: [
      ['stockcode', sql.NVarChar(20)], ['name', sql.NVarChar(300)], ['brand', sql.NVarChar(150)],
      ['category', sql.NVarChar(100)], ['package_size', sql.NVarChar(50)], ['pack_qty', sql.Int],
      ['price', decimal(10, 2)], ['was_price', decimal(10, 2)], ['savings', decimal(10, 2)],
      ['is_on_special', sql.Bit], ['is_member_special', sql.Bit], ['is_available', sql.Bit],
      ['stock_on_hand', sql.Int], ['rating', decimal(3, 2)], ['review_count', sql.Int],
      ['product_url', sql.NVarChar(500)], ['image_file', sql.NVarChar(200)], ['alcohol_pct', decimal(4, 1)],
      ['country', sql.NVarChar(100)], ['liquor_style', sql.NVarChar(100)], ['varietal', sql.NVarChar(100)],
      ['vintage', sql.NVarChar(100)],
    ],
    danmurphys_products: [
      ['stockcode', sql.NVarChar(50)], ['name', sql.NVarChar(300)], ['brand', sql.NVarChar(150)],
      ['category', sql.NVarChar(100)], ['package_size', sql.NVarChar(50)],
      ['price_single', decimal(10, 2)], ['price_unit_label', sql.NVarChar(50)],
      ['price_case', decimal(10, 2)], ['case_label', sql.NVarChar(50)], ['price_in_any_six', decimal(10, 2)],
      ['promo_price', decimal(10, 2)], ['promo_was_price', decimal(10, 2)], ['promo_type', sql.NVarChar(50)],
      ['is_member_offer', sql.Bit], ['is_on_special', sql.Bit], ['is_purchasable', sql.Bit],
      ['stock_on_hand', sql.Int], ['rating', decimal(3, 2)], ['review_count', sql.Int],
      ['product_url', sql.NVarChar(500)], ['image_url', sql.NVarChar(500)], ['alcohol_pct', decimal(4, 1)],
      ['country', sql.NVarChar(100)], ['varietal', sql.NVarChar(100)], ['vintage', sql.NVarChar(100)],
    ],
    liquorland_products: [
      ['product_id', sql.NVarChar(20)], ['name', sql.NVarChar(300)], ['brand', sql.NVarChar(150)],
      ['category', sql.NVarChar(100)], ['volume_ml', sql.Int], ['packaging', sql.NVarChar(50)],
      ['pack_label', sql.NVarChar(50)], ['price', decimal(10, 2)], ['normal_price', decimal(10, 2)],
      ['price_per_six', decimal(10, 2)], ['member_price', decimal(10, 2)], ['promo_text', sql.NVarChar(200)],
      ['is_available', sql.Bit], ['stock_status', sql.NVarChar(50)], ['rating', decimal(3, 2)],
      ['review_count', sql.Int], ['product_url', sql.NVarChar(500)], ['image_url', sql.NVarChar(500)],
      ['is_bundle', sql.Bit],
    ],
  };
  common.firstchoice_products = common.liquorland_products;
  return common[table];
}

async function ensureSchema(pool: sql.ConnectionPool) {
  await pool.request().query(DDL);
  for (const [table, createSql] of Object.entries(TABLES)) {
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
                     WHERE s.name = '${SCHEMA}' AND t.name = '${table}')
      BEGIN
        ${createSql}
      END`);
  }
}

export async function importSite(site: string, crawlDate: string, dataRoot = 'data'): Promise<void> {
  const table = SITE_TABLE[site];
  if (!table) {
    console.warn(`[db-import] Unknown site ${site}, skipping DB import`);
    return;
  }
  const siteDir = path.join(dataRoot, crawlDate, site);
  const files = walkJsonFiles(siteDir);
  if (files.length === 0) {
    console.warn(`[db-import] No JSON files in ${siteDir}, nothing to import`);
    return;
  }

  let rows: any[];
  if (site === 'bws.com.au') rows = parseBws(siteDir, files);
  else if (site === 'danmurphys.com.au') rows = parseDanMurphys(siteDir, files);
  else if (site === 'liquorland.com.au') rows = parseColes(siteDir, files, 'https://www.liquorland.com.au');
  else rows = parseColes(siteDir, files, 'https://www.firstchoiceliquor.com.au');

  console.log(`[db-import] ${site}: parsed ${rows.length} unique products from ${files.length} files`);
  if (rows.length === 0) return;

  const pool = await sql.connect(DB_CONFIG);
  try {
    await ensureSchema(pool);

    // idempotent re-runs: replace this crawl_date's rows for this site
    await pool.request()
      .input('d', sql.Date, crawlDate)
      .query(`DELETE FROM ${SCHEMA}.${table} WHERE crawl_date = @d`);

    const cols = tableColumns(table);
    const bulkTable = new sql.Table(`${SCHEMA}.${table}`);
    bulkTable.create = false;
    bulkTable.columns.add('crawl_date', sql.Date, { nullable: false });
    for (const [colName, colType] of cols) {
      const notNull = ['stockcode', 'product_id', 'name', 'price', 'price_single'].includes(colName);
      bulkTable.columns.add(colName, colType, { nullable: !notNull });
    }
    for (const r of rows) {
      bulkTable.rows.add(crawlDate, ...cols.map(([colName]) => r[colName] ?? null));
    }
    const result = await pool.request().bulk(bulkTable);
    console.log(`[db-import] ${site}: inserted ${result.rowsAffected} rows into ${SCHEMA}.${table} (crawl_date=${crawlDate})`);
  } finally {
    await pool.close();
  }
}

// Standalone: bun run db-import.ts <date> [site]
if (import.meta.main) {
  const crawlDate = process.argv[2];
  const onlySite = process.argv[3];
  if (!crawlDate || !/^\d{4}-\d{2}-\d{2}$/.test(crawlDate)) {
    console.error('Usage: bun run db-import.ts <YYYY-MM-DD> [site]');
    process.exit(1);
  }
  const sites = onlySite ? [onlySite] : Object.keys(SITE_TABLE);
  for (const site of sites) {
    try {
      await importSite(site, crawlDate);
    } catch (e) {
      console.error(`[db-import] ${site} failed:`, (e as Error).message);
    }
  }
  process.exit(0);
}
