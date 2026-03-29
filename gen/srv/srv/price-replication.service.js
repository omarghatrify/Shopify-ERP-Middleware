"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const PriceReplicationService_1 = require("#cds-models/PriceReplicationService");
const cds_1 = __importDefault(require("@sap/cds"));
const shopify_js_1 = __importDefault(require("./shopify.js"));
const { SELECT, INSERT, UPDATE } = cds_1.default.ql;
const VARIANTS_BULK_UPDATE = `#graphql
mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants {
      id
    }
    userErrors {
      field
      message
      code
    }
  }
}`;
function moneyString(amount) {
    const n = Number(amount);
    if (Number.isNaN(n) || n < 0) {
        return '0.00';
    }
    return n.toFixed(2);
}
function parseValidFrom(v) {
    if (v == null) {
        return new Date();
    }
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? new Date() : d;
}
exports.default = cds_1.default.service.impl(async function (srv) {
    const DB = await cds_1.default.connect.to('db');
    srv.on(PriceReplicationService_1.SyncPrice, async (req) => {
        const { data } = req.data;
        if (!Array.isArray(data) || data.length === 0) {
            return req.error(400, 'Data is required');
        }
        const tx = DB.tx(req);
        const now = new Date();
        const byKey = new Map();
        for (const item of data) {
            const key = `${item.sku}\0${item.currency}`;
            byKey.set(key, item);
        }
        for (const item of byKey.values()) {
            const validFrom = parseValidFrom(item.validFrom);
            const existing = await tx.run(SELECT.one.from(PriceReplicationService_1.ScheduledPrice).where({
                sku: item.sku,
                currency: item.currency,
            }));
            if (!existing) {
                await tx.run(INSERT.into(PriceReplicationService_1.ScheduledPrice).entries({
                    sku: item.sku,
                    currency: item.currency,
                    price: item.price,
                    validFrom: validFrom.toISOString(),
                    last_updated_at: now.toISOString(),
                    needs_replication: true,
                }));
            }
            else {
                const priceChanged = Number(existing.price) !== Number(item.price);
                const validChanged = new Date(existing.validFrom).getTime() !== validFrom.getTime();
                if (priceChanged || validChanged) {
                    await tx.run(UPDATE.entity(PriceReplicationService_1.ScheduledPrice)
                        .set({
                        price: item.price,
                        validFrom: validFrom.toISOString(),
                        last_updated_at: now.toISOString(),
                        needs_replication: true,
                    })
                        .where({
                        sku: item.sku,
                        currency: item.currency,
                    }));
                }
            }
        }
        return { message: 'Processed' };
    });
    cds_1.default.on('served', async () => {
        console.log('Price replication background job registered');
        const { session } = await shopify_js_1.default.auth.clientCredentials({
            shop: process.env.SHOPIFY_STORE_NAME,
        });
        const client = new shopify_js_1.default.clients.Graphql({ session });
        let jobRunning = false;
        cds_1.default.spawn({
            user: cds_1.default.User.privileged,
            every: 15000,
        }, async (tx) => {
            if (jobRunning) {
                console.log('Price replication skipped (already running)');
                return;
            }
            jobRunning = true;
            try {
                const now = new Date();
                const rows = await tx.run(SELECT.from(PriceReplicationService_1.ScheduledPrice, (sp) => {
                    sp.sku;
                    sp.currency;
                    sp.price;
                    sp.validFrom;
                    sp.replication_attempts;
                    sp.Product((p) => {
                        p.shopify_variant_id;
                        p.shopify_product_id;
                    });
                })
                    .where({
                    needs_replication: true,
                    validFrom: { '<=': now.toISOString() },
                })
                    .limit(250));
                if (!rows.length) {
                    return;
                }
                const validRows = rows.filter((r) => r.Product?.shopify_variant_id && r.Product?.shopify_product_id);
                if (!validRows.length) {
                    console.log('No scheduled prices with Shopify product/variant IDs');
                    return;
                }
                console.log('Price replication started');
                const byProduct = new Map();
                for (const r of validRows) {
                    const pid = r.Product.shopify_product_id;
                    if (!byProduct.has(pid)) {
                        byProduct.set(pid, []);
                    }
                    byProduct.get(pid).push(r);
                }
                for (const [productId, group] of byProduct) {
                    const variants = group.map((r) => ({
                        id: r.Product.shopify_variant_id,
                        price: moneyString(r.price),
                        inventoryItem: { cost: moneyString(r.price) },
                    }));
                    const { data: gqlData } = await client.request(VARIANTS_BULK_UPDATE, {
                        variables: { productId, variants },
                    });
                    const result = gqlData?.productVariantsBulkUpdate;
                    if (result?.userErrors?.length) {
                        console.error('Shopify productVariantsBulkUpdate userErrors:', result.userErrors);
                        await Promise.all(group.map((r) => tx.run(UPDATE.entity(PriceReplicationService_1.ScheduledPrice)
                            .with({
                            replication_attempts: (r.replication_attempts || 0) + 1,
                            last_error: JSON.stringify(result.userErrors),
                        })
                            .where({
                            sku: r.sku,
                            currency: r.currency,
                        }))));
                        continue;
                    }
                    const replicatedAt = new Date().toISOString();
                    await Promise.all(group.map((r) => tx.run(UPDATE.entity(PriceReplicationService_1.ScheduledPrice)
                        .with({
                        needs_replication: false,
                        last_replicated_at: replicatedAt,
                        replication_attempts: 0,
                        last_error: null,
                    })
                        .where({
                        sku: r.sku,
                        currency: r.currency,
                    }))));
                    console.log(`Replicated ${group.length} price(s) for product ${productId}`);
                }
            }
            catch (err) {
                console.error('Price replication failed:', err);
            }
            finally {
                jobRunning = false;
            }
        });
    });
});
//# sourceMappingURL=price-replication.service.js.map