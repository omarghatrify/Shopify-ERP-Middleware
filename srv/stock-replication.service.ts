import { Inventory, SyncStock } from '#cds-models/StockReplicationService';
import cds from '@sap/cds';
import shopify from './shopify.js';
import { SHOPIFY_DEFAULT_LOCATION_ID } from './lib/shopify-default-location.js';

const { SELECT, INSERT, UPDATE } = cds.ql;

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

type InventoryProductRef = { shopify_inventory_id?: string | null };

function buildInventoryPayload(
    rows: { Product?: InventoryProductRef; locationId: string; quantity: unknown }[],
) {
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

export default cds.service.impl(async function (srv) {
    const DB = await cds.connect.to('db');

    srv.on(SyncStock, async (req) => {
        const { data } = req.data;

        if (!Array.isArray(data) || data.length === 0) {
            return req.error(400, 'Data is required');
        }

        const tx = DB.tx(req);
        const now = new Date();
        const locationId = SHOPIFY_DEFAULT_LOCATION_ID;

        for (const item of data) {
            const existing = await tx.run(
                SELECT.one.from(Inventory).where({
                    sku: item.sku,
                    locationId,
                }),
            );

            if (!existing) {
                await tx.run(
                    INSERT.into(Inventory).entries({
                        sku: item.sku!,
                        locationId,
                        quantity: item.qty!,
                        last_updated_at: now.toISOString(),
                        needs_replication: true,
                    }),
                );
            } else if (existing.quantity !== item.qty) {
                await tx.run(
                    UPDATE.entity(Inventory)
                        .set({
                            quantity: item.qty!,
                            last_updated_at: now.toISOString(),
                            needs_replication: true,
                        })
                        .where({
                            sku: item.sku,
                            locationId,
                        }),
                );
            }
        }

        return { message: 'Processed' };
    });

    cds.on('served', async () => {
        console.log('Stock replication background job registered');
        const { session } = await shopify.auth.clientCredentials({
            shop: process.env.SHOPIFY_STORE_NAME!,
        });
        const client = new shopify.clients.Graphql({ session });

        let jobRunning = false;

        cds.spawn(
            {
                user: cds.User.privileged,
                every: 2000,
            },
            async (tx) => {
                if (jobRunning) {
                    console.log('Stock replication skipped (already running)');
                    return;
                }

                jobRunning = true;

                try {


                    const rows = await tx.run(
                        SELECT.from(Inventory, (inv) => {
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
                            .limit(250),
                    );

                    if (!rows.length) {
                        // console.log('No stock changes to replicate');
                        return;
                    }

                    const validRows = rows.filter(
                        (r: { Product?: InventoryProductRef }) => r.Product?.shopify_inventory_id,
                    );

                    if (!validRows.length) {
                        console.log('No valid rows with Shopify inventory ID');
                        return;
                    }

                    console.log('Stock replication started');

                    const payload = buildInventoryPayload(validRows);

                    const { data } = await client.request(INVENTORY_SET_MUTATION, {
                        variables: payload,
                    });

                    const result = data?.inventorySetQuantities as
                        | {
                            userErrors?: { field?: string[]; message: string }[];
                        }
                        | undefined;

                    if (result?.userErrors?.length) {
                        console.error('Shopify userErrors:', result.userErrors);

                        await Promise.all(
                            validRows.map((r: { sku: string; locationId: string; replication_attempts?: number }) =>
                                tx.run(
                                    UPDATE.entity(Inventory)
                                        .with({
                                            replication_attempts: (r.replication_attempts || 0) + 1,
                                            last_error: JSON.stringify(result.userErrors),
                                        })
                                        .where({
                                            sku: r.sku,
                                            locationId: r.locationId,
                                        }),
                                ),
                            ),
                        );

                        return;
                    }

                    const now = new Date();

                    await Promise.all(
                        validRows.map((r: { sku: string; locationId: string }) =>
                            tx.run(
                                UPDATE.entity(Inventory)
                                    .with({
                                        needs_replication: false,
                                        last_replicated_at: now.toISOString(),
                                        replication_attempts: 0,
                                        last_error: null,
                                    })
                                    .where({
                                        sku: r.sku,
                                        locationId: r.locationId,
                                    }),
                            ),
                        ),
                    );

                    console.log(`Replicated ${validRows.length} inventory records`);
                } catch (err) {
                    console.error('Stock replication failed:', err);
                } finally {
                    jobRunning = false;
                }
            },
        );
    });
});
