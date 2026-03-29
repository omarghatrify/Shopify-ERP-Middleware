import type { CdsDate } from '#cds-models/_';
import { ScheduledPrice, SyncPrice } from '#cds-models/PriceReplicationService';
import cds from '@sap/cds';
import moment from 'moment';
import shopify from './shopify.js';

/** SAP / API calendar date: `2025-11-24` (`YYYY-MM-DD`). */
const CDS_DATE_FMT = 'YYYY-MM-DD';

const { SELECT, INSERT, UPDATE } = cds.ql;

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

type ProductRefs = {
    shopify_variant_id?: string | null;
    shopify_product_id?: string | null;
};

function moneyString(amount: unknown): string {
    const n = Number(amount);
    if (Number.isNaN(n) || n < 0) {
        return '0.00';
    }
    return n.toFixed(2);
}

function todayAsCdsDate(): CdsDate {
    return moment.utc().format(CDS_DATE_FMT) as CdsDate;
}

/** Parse `validFrom` as calendar date; primary format `2025-11-24`. */
function parseValidFrom(v: unknown): CdsDate {
    if (v == null) {
        return todayAsCdsDate();
    }
    if (typeof v === 'string') {
        const head = v.trim().slice(0, 10);
        const strict = moment.utc(head, CDS_DATE_FMT, true);
        if (strict.isValid()) {
            return strict.format(CDS_DATE_FMT) as CdsDate;
        }
        const loose = moment.utc(v);
        if (loose.isValid()) {
            return loose.format(CDS_DATE_FMT) as CdsDate;
        }
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
        const m = moment.utc(v);
        if (m.isValid()) {
            return m.format(CDS_DATE_FMT) as CdsDate;
        }
    }
    return todayAsCdsDate();
}

function normalizeStoredValidFrom(v: unknown): CdsDate {
    const head = String(v).trim().slice(0, 10);
    const strict = moment.utc(head, CDS_DATE_FMT, true);
    if (strict.isValid()) {
        return strict.format(CDS_DATE_FMT) as CdsDate;
    }
    const m = moment.utc(String(v));
    return (m.isValid() ? m.format(CDS_DATE_FMT) : todayAsCdsDate()) as CdsDate;
}

export default cds.service.impl(async function (srv) {
    const DB = await cds.connect.to('db');

    srv.on(SyncPrice, async (req) => {
        const { data } = req.data;

        if (!Array.isArray(data) || data.length === 0) {
            return req.error(400, 'Data is required');
        }

        const tx = DB.tx(req);
        const now = moment.utc().toISOString();

        const byKey = new Map<string, (typeof data)[0]>();
        for (const item of data) {
            const key = `${item.sku}\0${item.currency}`;
            byKey.set(key, item);
        }

        for (const item of byKey.values()) {
            const validFromDate = parseValidFrom(item.validFrom);
            const existing = await tx.run(
                SELECT.one.from(ScheduledPrice).where({
                    sku: item.sku,
                    currency: item.currency,
                }),
            );

            if (!existing) {
                await tx.run(
                    INSERT.into(ScheduledPrice).entries({
                        sku: item.sku!,
                        currency: item.currency!,
                        price: item.price!,
                        validFrom: validFromDate,
                        last_updated_at: now,
                        needs_replication: true,
                    }),
                );
            } else {
                const existingDate = normalizeStoredValidFrom(existing.validFrom);
                const priceChanged = Number(existing.price) !== Number(item.price);
                const validChanged = existingDate !== validFromDate;
                if (priceChanged || validChanged) {
                    await tx.run(
                        UPDATE.entity(ScheduledPrice)
                            .set({
                                price: item.price!,
                                validFrom: validFromDate,
                                last_updated_at: now,
                                needs_replication: true,
                            })
                            .where({
                                sku: item.sku,
                                currency: item.currency,
                            }),
                    );
                }
            }
        }

        return { message: 'Processed' };
    });

    cds.on('served', async () => {
        console.log('Price replication background job registered');
        const { session } = await shopify.auth.clientCredentials({
            shop: process.env.SHOPIFY_STORE_NAME!,
        });
        const client = new shopify.clients.Graphql({ session });

        let jobRunning = false;

        cds.spawn(
            {
                user: cds.User.privileged,
                every: 15000,
            },
            async (tx) => {
                if (jobRunning) {
                    console.log('Price replication skipped (already running)');
                    return;
                }

                jobRunning = true;

                try {
                    console.log('Price replication started');
                    const today = todayAsCdsDate();

                    const rows = await tx.run(
                        SELECT.from(ScheduledPrice, (sp) => {
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
                                validFrom: { '<=': today },
                            })
                            .limit(250),
                    );

                    if (!rows.length) {
                        console.log('No price changes to replicate');
                        return;
                    }

                    const validRows = rows.filter(
                        (r: { Product?: ProductRefs }) =>
                            r.Product?.shopify_variant_id && r.Product?.shopify_product_id,
                    );

                    if (!validRows.length) {
                        console.log('No scheduled prices with Shopify product/variant IDs');
                        return;
                    }

                    const byProduct = new Map<
                        string,
                        Array<{
                            sku: string;
                            currency: string;
                            price: unknown;
                            replication_attempts?: number;
                            Product?: ProductRefs;
                        }>
                    >();

                    for (const r of validRows) {
                        const pid = r.Product!.shopify_product_id!;
                        if (!byProduct.has(pid)) {
                            byProduct.set(pid, []);
                        }
                        byProduct.get(pid)!.push(r);
                    }

                    for (const [productId, group] of byProduct) {
                        const variants = group.map((r) => ({
                            id: r.Product!.shopify_variant_id!,
                            price: moneyString(r.price),
                            inventoryItem: { cost: moneyString(r.price) },
                        }));

                        const { data: gqlData } = await client.request(VARIANTS_BULK_UPDATE, {
                            variables: { productId, variants },
                        });

                        const result = gqlData?.productVariantsBulkUpdate as
                            | {
                                userErrors?: { field?: string[]; message: string }[];
                            }
                            | undefined;

                        if (result?.userErrors?.length) {
                            console.error('Shopify productVariantsBulkUpdate userErrors:', result.userErrors);

                            await Promise.all(
                                group.map((r) =>
                                    tx.run(
                                        UPDATE.entity(ScheduledPrice)
                                            .with({
                                                replication_attempts: (r.replication_attempts || 0) + 1,
                                                last_error: JSON.stringify(result.userErrors),
                                            })
                                            .where({
                                                sku: r.sku,
                                                currency: r.currency,
                                            }),
                                    ),
                                ),
                            );
                            continue;
                        }

                        const replicatedAt = moment.utc().toISOString();

                        await Promise.all(
                            group.map((r) =>
                                tx.run(
                                    UPDATE.entity(ScheduledPrice)
                                        .with({
                                            needs_replication: false,
                                            last_replicated_at: replicatedAt,
                                            replication_attempts: 0,
                                            last_error: null,
                                        })
                                        .where({
                                            sku: r.sku,
                                            currency: r.currency,
                                        }),
                                ),
                            ),
                        );

                        console.log(
                            `Replicated ${group.length} price(s) for product ${productId}`,
                        );
                    }
                } catch (err) {
                    console.error('Price replication failed:', err);
                } finally {
                    jobRunning = false;
                }
            },
        );
    });
});
