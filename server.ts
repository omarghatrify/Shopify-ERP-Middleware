import { Products, Product } from '#cds-models/IntegrationService';
import { Inventory } from '#cds-models/IntegrationService';

import cds from '@sap/cds';
import shopify from './srv/shopify.js';

const { SELECT, UPDATE } = cds.ql;

const VARIANT_BY_SKU_QUERY = `#graphql
query getVariantBySKU($sku: String!) {
  productVariants(first: 1, query: $sku) {
    edges {
      node {
        id
        sku
        product {
          id
        }
        inventoryItem {
          id
        }
      }
    }
  }
}`;

const PRODUCT_SET_MUTATION = `#graphql
mutation productCreate($input: ProductSetInput!) {
  productSet(input: $input) {
    product {
      id
      variants(first: 1) {
        nodes {
          id
          inventoryItem {
            id
          }
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}`;

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

type GraphqlAdminClient = {
    request: (
        query: string,
        options?: { variables?: Record<string, unknown> },
    ) => Promise<{ data?: Record<string, unknown> }>;
};

type ProductReplicationPayload = {
    sku: string;
    shopify_product_id: string;
    shopify_variant_id: string;
    shopify_inventory_id: string;
    modified_at: string;
};

async function replicateProductToShopify(
    client: GraphqlAdminClient,
    row: Product,
): Promise<ProductReplicationPayload | null> {
    const sku = row.sap_material;
    if (!sku) return null;

    try {
        const { data: variantData } = await client.request(VARIANT_BY_SKU_QUERY, {
            variables: { sku: `sku:${sku}` },
        });
        const edges =
            (variantData?.productVariants as { edges?: unknown[] } | undefined)?.edges ?? [];
        const now = new Date().toISOString();

        let shopify_product_id: string | undefined;
        let shopify_variant_id: string | undefined;
        let shopify_inventory_id: string | undefined;

        if (edges.length === 0) {
            const name_en =
                row.name?.find((n) => n.lang?.toUpperCase() === 'EN')?.val ||
                row.name?.[0]?.val ||
                'Default';
            const desc_en =
                row.desc?.find((d) => d.lang?.toUpperCase() === 'EN')?.val ||
                row.desc?.[0]?.val ||
                'Default';

            const productInput = {
                title: name_en,
                status: 'DRAFT' as const,
                descriptionHtml: `${desc_en}`,
                productOptions: [{ name: 'Title', values: [{ name: name_en }] }],
                variants: [
                    {
                        price: '0.00',
                        optionValues: [{ optionName: 'Title', name: name_en }],
                        inventoryItem: { cost: '0.00', sku, tracked: true },
                    },
                ],
            };

            const { data: createResult } = await client.request(PRODUCT_SET_MUTATION, {
                variables: { input: productInput },
            });
            const productSet = createResult?.productSet as
                | {
                    userErrors?: { field?: string[]; message: string }[];
                    product?: {
                        id?: string;
                        variants?: { nodes?: { id?: string; inventoryItem?: { id?: string } }[] };
                    };
                }
                | undefined;
            const userErrors = productSet?.userErrors;
            if (userErrors?.length) {
                console.error(`Shopify productSet userErrors for ${sku}:`, userErrors);
                return null;
            }
            const variant = productSet?.product?.variants?.nodes?.[0];
            shopify_product_id = productSet?.product?.id;
            shopify_variant_id = variant?.id;
            shopify_inventory_id = variant?.inventoryItem?.id;
        } else {
            const node = (edges[0] as { node?: Record<string, unknown> })?.node as
                | {
                    id?: string;
                    product?: { id?: string };
                    inventoryItem?: { id?: string };
                }
                | undefined;
            shopify_product_id = node?.product?.id;
            shopify_variant_id = node?.id;
            shopify_inventory_id = node?.inventoryItem?.id;
        }

        if (shopify_product_id && shopify_variant_id && shopify_inventory_id) {
            console.log('Replicated Product', sku, shopify_product_id, shopify_variant_id, shopify_inventory_id);
            return {
                sku,
                shopify_product_id,
                shopify_variant_id,
                shopify_inventory_id,
                modified_at: now,
            };
        }
        return null;
    } catch (err) {
        console.error(`Replicate product to Shopify failed for ${sku}:`, err);
        return null;
    }
}


function buildInventoryPayload(rows: any[]) {
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


cds.on('served', async () => {
    console.log('Shopify service started');
    const { session } = await shopify.auth.clientCredentials({
        shop: process.env.SHOPIFY_STORE_NAME!,
    });
    const client = new shopify.clients.Graphql({ session });

    let replicateJobRunning = false;

    cds.spawn(
        {
            user: cds.User.privileged,
            every: 20000,
        },
        async (tx) => {
            if (replicateJobRunning) {
                console.log('Replicate products to Shopify skipped (previous run still in progress)');
                return;
            }
            replicateJobRunning = true;
            try {
                console.log('Replicate products to Shopify started');
                const products = (await tx.run(
                    SELECT.from(Products).where({ shopify_inventory_id: null }).limit(200),
                )) as Product[];
                console.log(`Found ${products.length} products to replicate`);

                const payloads = await Promise.all(
                    products.map((row) => replicateProductToShopify(client, row)),
                );
                const toPersist = payloads.filter((p): p is ProductReplicationPayload => p != null);

                await Promise.all(
                    toPersist.map((p) =>
                        tx.run(
                            UPDATE.entity(Products, p.sku).set({
                                shopify_product_id: p.shopify_product_id,
                                shopify_variant_id: p.shopify_variant_id,
                                shopify_inventory_id: p.shopify_inventory_id,
                                modified_at: p.modified_at,
                            }),
                        ),
                    ),
                );
            } finally {
                replicateJobRunning = false;
            }
        },
    );
});


cds.on('served', async () => {
    console.log('Stock replication service started');

    const { session } = await shopify.auth.clientCredentials({
        shop: process.env.SHOPIFY_STORE_NAME!,
    });

    const client = new shopify.clients.Graphql({ session });

    let jobRunning = false;

    cds.spawn(
        {
            user: cds.User.privileged,
            every: 15000, // every 15 sec (tune this)
        },
        async (tx) => {
            if (jobRunning) {
                console.log('Stock replication skipped (already running)');
                return;
            }

            jobRunning = true;

            try {
                console.log('Stock replication started');

                // ✅ 1. Fetch only changed + valid rows
                const rows = await tx.run(
                    SELECT.from(Inventory, inv => {
                        inv.sku;
                        inv.quantity;
                        inv.locationId;
                        inv.replication_attempts;
                        inv.Product(p => {
                            p.shopify_inventory_id;
                        });
                    })
                        .where({
                            needs_replication: true,
                        })
                        .limit(250)
                );

                if (!rows.length) {
                    console.log('No stock changes to replicate');
                    return;
                }

                // ❌ Filter invalid (no Shopify mapping)
                const validRows = rows.filter(
                    (r: { Product: Product; }) => r.Product?.shopify_inventory_id
                );

                if (!validRows.length) {
                    console.log('No valid rows with Shopify inventory ID');
                    return;
                }

                // ✅ 2. Build payload
                const payload = buildInventoryPayload(validRows);

                // ✅ 3. Call Shopify
                const { data } = await client.request(
                    INVENTORY_SET_MUTATION,
                    { variables: payload }
                );

                const result = data?.inventorySetQuantities as
                    | {
                        userErrors?: { field?: string[]; message: string }[];
                    }
                    | undefined;

                // ❌ Shopify-level errors
                if (result?.userErrors?.length) {
                    console.error('Shopify userErrors:', result.userErrors);

                    await Promise.all(
                        validRows.map((r: any) =>
                            tx.run(
                                UPDATE.entity(Inventory)
                                    .with({
                                        replication_attempts: (r.replication_attempts || 0) + 1,
                                        last_error: JSON.stringify(result.userErrors),
                                    }).where({
                                        sku: r.sku,
                                        locationId: r.locationId,
                                    })
                            )
                        )
                    );

                    return;
                }

                // ✅ 4. Success → mark replicated
                const now = new Date();

                await Promise.all(
                    validRows.map((r: any) =>
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
                                })
                        )
                    )
                );

                console.log(`Replicated ${validRows.length} inventory records`);
            } catch (err) {
                console.error('Stock replication failed:', err);
            } finally {
                jobRunning = false;
            }
        }
    );
});