import { LoadProducts, Product, Products, SyncProducts } from '#cds-models/ProductReplicationService';
import cds from '@sap/cds';
import shopify from './shopify.js';

const { SELECT, INSERT, UPDATE } = cds.ql;

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
            console.log(
                'Replicated Product',
                sku,
                shopify_product_id,
                shopify_variant_id,
                shopify_inventory_id,
            );
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

export default cds.service.impl(async function (srv) {
    const DB = await cds.connect.to('db');

    srv.before(SyncProducts, async (req) => {
        const { correlationId, materials, overwrite } = req.data;
        if (!correlationId) {
            req.data.correlationId = cds.utils.uuid();
        }
        if (!materials || materials.length === 0 || !Array.isArray(materials)) {
            req.error(400, 'Materials array is required');
        }
        if (typeof overwrite !== 'boolean') {
            req.error(400, 'Overwrite is required');
        }
        const seen = new Set<string>();
        const duplicates = [];
        for (const mat of materials) {
            if (seen.has(mat.sku!)) {
                duplicates.push(mat.sku);
            } else {
                seen.add(mat.sku!);
            }
        }
        if (duplicates.length > 0) {
            req.error(400, `Duplicate materials found: ${[...new Set(duplicates)].join(', ')}`);
        }
    });

    srv.before(LoadProducts, async (req) => {
        const { value } = req.data;
        if (!value || !Array.isArray(value) || value.length === 0) {
            req.error(400, 'value array is required');
        }
    });

    srv.on(LoadProducts, async function (req) {
        const { correlationId, overwrite, value } = req.data;
        const materials = value!.map((sp) => ({
            sku: sp.Product!,
            uom: sp.BaseUnit!,
            desc: (sp._ProductDescription ?? []).map((d) => ({
                val: d.ProductDescription!,
                lang: d.Language!,
            })),
            name: (sp._ProductDescription ?? []).map((d) => ({
                val: d.ProductDescription!,
                lang: d.Language!,
            })),
        }));

        const tx = srv.tx(req);
        return tx.send({
            event: SyncProducts,
            data: {
                correlationId: correlationId ?? cds.utils.uuid(),
                materials,
                overwrite: typeof overwrite === 'boolean' ? overwrite : true,
            },
        });
    });

    srv.on(SyncProducts, async (req) => {
        const { correlationId, materials } = req.data;
        const tx = DB.tx(req);

        console.log('SyncProducts on', materials.length);

        const statuses = await Promise.all(
            materials.map(async (mat) => {
                const product = await tx.run(SELECT.one.from(Products, mat.sku!));
                if (product) {
                    console.log('SyncProducts on', mat.sku!, 'EXISTING');
                    await tx.run(
                        UPDATE.entity(Products, mat.sku!).set({
                            sap_material: mat.sku!,
                            uom: mat.uom!,
                            name: mat.name!,
                            desc: mat.desc!,
                        }),
                    );
                    return { material: mat.sku!, status: 'EXISTING' as const };
                }
                console.log('SyncProducts on', mat.sku!, 'NEW');
                await tx.run(
                    INSERT.into(Products).entries({
                        sap_material: mat.sku!,
                        uom: mat.uom!,
                        name: mat.name!,
                        desc: mat.desc!,
                    }),
                );
                return { material: mat.sku!, status: 'NEW' as const };
            }),
        );

        return {
            correlationId,
            status: statuses,
        };
    });

    cds.on('served', async () => {
        console.log('Product replication background job registered');
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
                    console.log(
                        'Replicate products to Shopify skipped (previous run still in progress)',
                    );
                    return;
                }
                replicateJobRunning = true;
                try {
                    console.log('Replicate products to Shopify started');
                    const products = (await tx.run(
                        SELECT.from(Products).where({ shopify_inventory_id: null }).limit(120),
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
});
