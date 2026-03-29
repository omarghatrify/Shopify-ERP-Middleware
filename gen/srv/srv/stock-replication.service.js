"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const StockReplicationService_1 = require("#cds-models/StockReplicationService");
const cds_1 = __importDefault(require("@sap/cds"));
const shopify_js_1 = __importDefault(require("./shopify.js"));
const shopify_default_location_js_1 = require("./lib/shopify-default-location.js");
const { SELECT, INSERT, UPDATE } = cds_1.default.ql;
const INVENTORY_SET_MUTATION = `#graphql
mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
        inventoryAdjustmentGroup {
            createdAt
            reason
        }
        userErrors {
            field
            message
        }
    }
}`;
function buildInventoryPayload(rows) {
    return {
        input: {
            name: 'available',
            reason: 'correction',
            ignoreCompareQuantity: true,
            quantities: rows.map((r) => ({
                inventoryItemId: r.Product?.shopify_inventory_id,
                locationId: r.locationId,
                quantity: r.quantity,
            })),
        },
    };
}
exports.default = cds_1.default.service.impl(async function (srv) {
    const DB = await cds_1.default.connect.to('db');
    srv.on(StockReplicationService_1.SyncStock, async (req) => {
        const { data } = req.data;
        if (!Array.isArray(data) || data.length === 0) {
            return req.error(400, 'Data is required');
        }
        const tx = DB.tx(req);
        const now = new Date();
        const locationId = shopify_default_location_js_1.SHOPIFY_DEFAULT_LOCATION_ID;
        for (const item of data) {
            const existing = await tx.run(SELECT.one.from(StockReplicationService_1.Inventory).where({
                sku: item.sku,
                locationId,
            }));
            if (!existing) {
                await tx.run(INSERT.into(StockReplicationService_1.Inventory).entries({
                    sku: item.sku,
                    locationId,
                    quantity: item.qty,
                    last_updated_at: now.toISOString(),
                    needs_replication: true,
                }));
            }
            else if (existing.quantity !== item.qty) {
                await tx.run(UPDATE.entity(StockReplicationService_1.Inventory)
                    .set({
                    quantity: item.qty,
                    last_updated_at: now.toISOString(),
                    needs_replication: true,
                })
                    .where({
                    sku: item.sku,
                    locationId,
                }));
            }
        }
        return { message: 'Processed' };
    });
    cds_1.default.on('served', async () => {
        console.log('Stock replication background job registered');
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
                console.log('Stock replication skipped (already running)');
                return;
            }
            jobRunning = true;
            try {
                console.log('Stock replication started');
                const rows = await tx.run(SELECT.from(StockReplicationService_1.Inventory, (inv) => {
                    inv.sku;
                    inv.quantity;
                    inv.locationId;
                    inv.replication_attempts;
                    inv.Product((p) => {
                        p.shopify_inventory_id;
                    });
                })
                    .where({
                    needs_replication: true,
                })
                    .limit(250));
                if (!rows.length) {
                    console.log('No stock changes to replicate');
                    return;
                }
                const validRows = rows.filter((r) => r.Product?.shopify_inventory_id);
                if (!validRows.length) {
                    console.log('No valid rows with Shopify inventory ID');
                    return;
                }
                const payload = buildInventoryPayload(validRows);
                const { data } = await client.request(INVENTORY_SET_MUTATION, {
                    variables: payload,
                });
                const result = data?.inventorySetQuantities;
                if (result?.userErrors?.length) {
                    console.error('Shopify userErrors:', result.userErrors);
                    await Promise.all(validRows.map((r) => tx.run(UPDATE.entity(StockReplicationService_1.Inventory)
                        .with({
                        replication_attempts: (r.replication_attempts || 0) + 1,
                        last_error: JSON.stringify(result.userErrors),
                    })
                        .where({
                        sku: r.sku,
                        locationId: r.locationId,
                    }))));
                    return;
                }
                const now = new Date();
                await Promise.all(validRows.map((r) => tx.run(UPDATE.entity(StockReplicationService_1.Inventory)
                    .with({
                    needs_replication: false,
                    last_replicated_at: now.toISOString(),
                    replication_attempts: 0,
                    last_error: null,
                })
                    .where({
                    sku: r.sku,
                    locationId: r.locationId,
                }))));
                console.log(`Replicated ${validRows.length} inventory records`);
            }
            catch (err) {
                console.error('Stock replication failed:', err);
            }
            finally {
                jobRunning = false;
            }
        });
    });
});
//# sourceMappingURL=stock-replication.service.js.map