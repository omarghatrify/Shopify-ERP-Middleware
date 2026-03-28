
import { Inventory, Product, Products, SyncProducts, SyncStock } from '#cds-models/IntegrationService';
import cds from '@sap/cds';
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

    srv.on(SyncProducts, async (req) => {
        const { correlationId, materials, overwrite } = req.data;
        const tx = DB.tx(req);

        console.log('SyncProducts on', materials.length);

        const statuses = await Promise.all(materials.map(async (mat) => {
            const product = await tx.run(SELECT.one.from(Products, mat.sku!));
            if (product) {
                console.log('SyncProducts on', mat.sku!, 'EXISTING');
                await tx.run(
                    UPDATE(Products, mat.sku!).set({
                        sap_material: mat.sku!,
                        uom: mat.uom!,
                        name: mat.name!,
                        desc: mat.desc!,
                    })
                );
                return { material: mat.sku!, status: 'EXISTING' };
            } else {
                console.log('SyncProducts on', mat.sku!, 'NEW');
                await tx.run(
                    INSERT.into(Products).entries({
                        sap_material: mat.sku!,
                        uom: mat.uom!,
                        name: mat.name!,
                        desc: mat.desc!,
                    })
                );
                return { material: mat.sku!, status: 'NEW' };
            }
        }));

        return {
            correlationId,
            status: statuses
        };
    });

    // const pp: Product[] = await DB.run(SELECT.from(Products).limit(250));
    // const pp2 = pp.map(p => ({
    //     sku: p.sap_material,
    //     stock: 100
    // }));
    // const fs = require('fs');
    // const path = require('path');
    // const stockFilePath = path.join(__dirname, 'stock_data.json');

    // try {
    //     fs.writeFileSync(stockFilePath, JSON.stringify(pp2, null, 2), 'utf8');
    //     console.log(`Stock data written to ${stockFilePath}`);
    // } catch (err) {
    //     console.error('Failed to write stock_data.json:', err);
    // }

    srv.on(SyncStock, async (req) => {
        const { data } = req.data;

        if (!Array.isArray(data) || data.length === 0) {
            return req.error(400, 'Data is required');
        }

        const tx = DB.tx(req);
        const now = new Date();

        for (const item of data) {
            const existing = await tx.run(
                SELECT.one.from(Inventory)
                    .where({
                        sku: item.sku,
                        locationId: 'gid://shopify/Location/88223219942'
                    })
            );

            if (!existing) {
                // New record
                await tx.run(
                    INSERT.into(Inventory).entries({
                        sku: item.sku!,
                        locationId: 'gid://shopify/Location/88223219942',
                        quantity: item.qty!,
                        last_updated_at: now.toISOString(),
                        needs_replication: true
                    })
                );
            } else if (existing.quantity !== item.qty) {
                // Only update if changed
                await tx.run(
                    UPDATE(Inventory)
                        .set({
                            quantity: item.qty!,
                            last_updated_at: now.toISOString(),
                            needs_replication: true
                        })
                        .where({
                            sku: item.sku,
                            locationId: 'gid://shopify/Location/88223219942'
                        })
                );
            }
            // else → do nothing (no change)
        }

        return { message: 'Processed' };
    });

    const proccessed_data: typeof SyncProducts.__parameters.materials = DATA.value.map(sp => {
        return {
            sku: sp.Product,
            uom: sp.BaseUnit,
            desc: sp._ProductDescription.map(d => ({ val: d.ProductDescription, lang: d.Language })),
            name: sp._ProductDescription.map(d => ({ val: d.ProductDescription, lang: d.Language }))
        }
    });
    console.log('SyncProducts emit', proccessed_data.length);
    srv.emit(SyncProducts, { materials: proccessed_data, overwrite: false, correlationId: cds.utils.uuid() });


});



const DATA = {
    "@odata.context": "$metadata#Product(Product,BaseUnit,_ProductDescription(Language,ProductDescription,Product))",
    "@odata.metadataEtag": "W/\"20260328050205\"",
    "value": [
        {
            "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
            "Product": "101/850/2019/5213",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
                    "Product": "101/850/2019/5213",
                    "Language": "AR",
                    "ProductDescription": "خاتم  ذهبي KR1000355"
                },
                {
                    "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
                    "Product": "101/850/2019/5213",
                    "Language": "EN",
                    "ProductDescription": "خاتم  ذهبي KR1000355"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
            "Product": "101/850/2019/5215",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
                    "Product": "101/850/2019/5215",
                    "Language": "AR",
                    "ProductDescription": "خاتم  ذهبي KR1001891"
                },
                {
                    "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
                    "Product": "101/850/2019/5215",
                    "Language": "EN",
                    "ProductDescription": "خاتم  ذهبي KR1001891"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
            "Product": "101/850/2019/5218",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
                    "Product": "101/850/2019/5218",
                    "Language": "AR",
                    "ProductDescription": "خاتم  ذهبي KR1001438-A"
                },
                {
                    "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
                    "Product": "101/850/2019/5218",
                    "Language": "EN",
                    "ProductDescription": "خاتم  ذهبي KR1001438-A"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
            "Product": "101/850/2019/5315",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
                    "Product": "101/850/2019/5315",
                    "Language": "AR",
                    "ProductDescription": "خاتم  فضى KR1001891"
                },
                {
                    "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
                    "Product": "101/850/2019/5315",
                    "Language": "EN",
                    "ProductDescription": "خاتم  فضى KR1001891"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
            "Product": "101/850/2019/5323",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
                    "Product": "101/850/2019/5323",
                    "Language": "AR",
                    "ProductDescription": "خاتم 4 PCS?15"
                },
                {
                    "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
                    "Product": "101/850/2019/5323",
                    "Language": "EN",
                    "ProductDescription": "خاتم 4 PCS?15"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
            "Product": "101/850/2019/6213",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
                    "Product": "101/850/2019/6213",
                    "Language": "AR",
                    "ProductDescription": "حلق  ذهبي KE1002136"
                },
                {
                    "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
                    "Product": "101/850/2019/6213",
                    "Language": "EN",
                    "ProductDescription": "حلق  ذهبي KE1002136"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
            "Product": "102/750/2019/1173",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
                    "Product": "102/750/2019/1173",
                    "Language": "AR",
                    "ProductDescription": "اسورة 17 / 3 / 19 مج 1فضى"
                },
                {
                    "@odata.etag": "W/\"SADL-202603162217350000000C~20260316221735.0000000\"",
                    "Product": "102/750/2019/1173",
                    "Language": "EN",
                    "ProductDescription": "اسورة 17 / 3 / 19 مج 1فضى"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271625050000000C~20260327162505.0000000\"",
            "Product": "11/701/30/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271625050000000C~20260327162505.0000000\"",
                    "Product": "11/701/30/333",
                    "Language": "AR",
                    "ProductDescription": "Ball 701/30 mm L.collection Low lead"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271625050000000C~20260327162505.0000000\"",
                    "Product": "11/701/30/333",
                    "Language": "EN",
                    "ProductDescription": "كرة 30/701 كولكشنLow lead"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624580000000C~20260327162458.0000000\"",
            "Product": "12/14/50/55",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624580000000C~20260327162458.0000000\"",
                    "Product": "12/14/50/55",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1050/14 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624580000000C~20260327162458.0000000\"",
                    "Product": "12/14/50/55",
                    "Language": "EN",
                    "ProductDescription": "حب 14/1050 RAIN"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624580000000C~20260327162458.0000000\"",
            "Product": "12/14/80/55",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624580000000C~20260327162458.0000000\"",
                    "Product": "12/14/80/55",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080/14 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624580000000C~20260327162458.0000000\"",
                    "Product": "12/14/80/55",
                    "Language": "EN",
                    "ProductDescription": "حب 14/1080 RAIN"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624550000000C~20260327162455.0000000\"",
            "Product": "12/401/15/53",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624550000000C~20260327162455.0000000\"",
                    "Product": "12/401/15/53",
                    "Language": "AR",
                    "ProductDescription": "Drop 401/1.5 Inch Rainbow Plus"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624550000000C~20260327162455.0000000\"",
                    "Product": "12/401/15/53",
                    "Language": "EN",
                    "ProductDescription": "دبوس 1.5/401 RAIN بلاس"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624550000000C~20260327162455.0000000\"",
            "Product": "12/701/40/55554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624550000000C~20260327162455.0000000\"",
                    "Product": "12/701/40/55554",
                    "Language": "AR",
                    "ProductDescription": "Ball 701/40 mm Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624550000000C~20260327162455.0000000\"",
                    "Product": "12/701/40/55554",
                    "Language": "EN",
                    "ProductDescription": "كرة 40/701 باللوجو درجة Rinbow"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624550000000C~20260327162455.0000000\"",
            "Product": "12/701/40/6664",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624550000000C~20260327162455.0000000\"",
                    "Product": "12/701/40/6664",
                    "Language": "AR",
                    "ProductDescription": "BALL 701/40 mm Almaza Green L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624550000000C~20260327162455.0000000\"",
                    "Product": "12/701/40/6664",
                    "Language": "EN",
                    "ProductDescription": "كرة 40/701 باللوجو جرين درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624540000000C~20260327162454.0000000\"",
            "Product": "12/911/20/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624540000000C~20260327162454.0000000\"",
                    "Product": "12/911/20/6",
                    "Language": "AR",
                    "ProductDescription": "Pendluque 911/2 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624540000000C~20260327162454.0000000\"",
                    "Product": "12/911/20/6",
                    "Language": "EN",
                    "ProductDescription": "مشط 2/911 موحدة جرين"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624540000000C~20260327162454.0000000\"",
            "Product": "12/911/25/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624540000000C~20260327162454.0000000\"",
                    "Product": "12/911/25/5554",
                    "Language": "AR",
                    "ProductDescription": "Pendluque 911/2.5 Inch Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624540000000C~20260327162454.0000000\"",
                    "Product": "12/911/25/5554",
                    "Language": "EN",
                    "ProductDescription": "مشط2.5/911 بوصه باللوجو جرين درجة Rinbow"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624540000000C~20260327162454.0000000\"",
            "Product": "12/911/25/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624540000000C~20260327162454.0000000\"",
                    "Product": "12/911/25/6",
                    "Language": "AR",
                    "ProductDescription": "Pendluque 911/2.5 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624540000000C~20260327162454.0000000\"",
                    "Product": "12/911/25/6",
                    "Language": "EN",
                    "ProductDescription": "مشط 2.5-911 درجه موحدة جرين"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624540000000C~20260327162454.0000000\"",
            "Product": "12/911/25/6664",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624540000000C~20260327162454.0000000\"",
                    "Product": "12/911/25/6664",
                    "Language": "AR",
                    "ProductDescription": "Pendluque 911/2.5 Inch Green Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624540000000C~20260327162454.0000000\"",
                    "Product": "12/911/25/6664",
                    "Language": "EN",
                    "ProductDescription": "مشط2.5/911 بوصه باللوجو جرين درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624530000000C~20260327162453.0000000\"",
            "Product": "120/210/10/17",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624530000000C~20260327162453.0000000\"",
                    "Product": "120/210/10/17",
                    "Language": "AR",
                    "ProductDescription": "Vasa Arabesque 210 mm"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624530000000C~20260327162453.0000000\"",
                    "Product": "120/210/10/17",
                    "Language": "EN",
                    "ProductDescription": "فازة ارابيسك 210مم"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624530000000C~20260327162453.0000000\"",
            "Product": "120/280/200/150",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624530000000C~20260327162453.0000000\"",
                    "Product": "120/280/200/150",
                    "Language": "AR",
                    "ProductDescription": "Chalet Bouquet Arabesque 150/200/280"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624530000000C~20260327162453.0000000\"",
                    "Product": "120/280/200/150",
                    "Language": "EN",
                    "ProductDescription": "شيالة بوكيه للزينة ارابيسك280/ 200/ 150"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624530000000C~20260327162453.0000000\"",
            "Product": "120/30/30/0",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624530000000C~20260327162453.0000000\"",
                    "Product": "120/30/30/0",
                    "Language": "AR",
                    "ProductDescription": "Chan. Bob (Luxor) 30 mm. L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624530000000C~20260327162453.0000000\"",
                    "Product": "120/30/30/0",
                    "Language": "EN",
                    "ProductDescription": "طبق نجفة الاقصر30 باللجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624530000000C~20260327162453.0000000\"",
            "Product": "120/30/30/1",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624530000000C~20260327162453.0000000\"",
                    "Product": "120/30/30/1",
                    "Language": "AR",
                    "ProductDescription": "Chan. Bob (Luxor) 30 mm."
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624530000000C~20260327162453.0000000\"",
                    "Product": "120/30/30/1",
                    "Language": "EN",
                    "ProductDescription": "طبق نجفة الاقصر30"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624520000000C~20260327162452.0000000\"",
            "Product": "120/600/150/1",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624520000000C~20260327162452.0000000\"",
                    "Product": "120/600/150/1",
                    "Language": "AR",
                    "ProductDescription": "Decoration plate  150 mm with cover."
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624520000000C~20260327162452.0000000\"",
                    "Product": "120/600/150/1",
                    "Language": "EN",
                    "ProductDescription": "طبق بوكية للزينة 150مم بالغطاء"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624520000000C~20260327162452.0000000\"",
            "Product": "13/14/50/77",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624520000000C~20260327162452.0000000\"",
                    "Product": "13/14/50/77",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1050/14 mm. Star"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624520000000C~20260327162452.0000000\"",
                    "Product": "13/14/50/77",
                    "Language": "EN",
                    "ProductDescription": "حب 14/1050 ستار"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624520000000C~20260327162452.0000000\"",
            "Product": "13/14/82/3",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624520000000C~20260327162452.0000000\"",
                    "Product": "13/14/82/3",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1082/14 mm. Star"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624520000000C~20260327162452.0000000\"",
                    "Product": "13/14/82/3",
                    "Language": "EN",
                    "ProductDescription": "حب 14 / 1082 ستار"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624520000000C~20260327162452.0000000\"",
            "Product": "13/14/82/77",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624520000000C~20260327162452.0000000\"",
                    "Product": "13/14/82/77",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1082/14 mm. Star"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624520000000C~20260327162452.0000000\"",
                    "Product": "13/14/82/77",
                    "Language": "EN",
                    "ProductDescription": "حب 14/1082 ستار"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624510000000C~20260327162451.0000000\"",
            "Product": "13/610/25/3",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624510000000C~20260327162451.0000000\"",
                    "Product": "13/610/25/3",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 610/2.5 Star"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624510000000C~20260327162451.0000000\"",
                    "Product": "13/610/25/3",
                    "Language": "EN",
                    "ProductDescription": "عقلة 610 / 2.5 ستار"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624510000000C~20260327162451.0000000\"",
            "Product": "13/610/25/53",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624510000000C~20260327162451.0000000\"",
                    "Product": "13/610/25/53",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 610 /2.5 Inch Star"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624510000000C~20260327162451.0000000\"",
                    "Product": "13/610/25/53",
                    "Language": "EN",
                    "ProductDescription": "عقلة 610 / 2.5 ستار"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624490000000C~20260327162449.0000000\"",
            "Product": "13/873/25/3",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624490000000C~20260327162449.0000000\"",
                    "Product": "13/873/25/3",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 873 / 2.5 Inch Star"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624490000000C~20260327162449.0000000\"",
                    "Product": "13/873/25/3",
                    "Language": "EN",
                    "ProductDescription": "لوزة 2.5 / 873 ستار"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624490000000C~20260327162449.0000000\"",
            "Product": "13/873/25/63",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624490000000C~20260327162449.0000000\"",
                    "Product": "13/873/25/63",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 873 /2.5 Inch Star"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624490000000C~20260327162449.0000000\"",
                    "Product": "13/873/25/63",
                    "Language": "EN",
                    "ProductDescription": "لوزة 2.5 / 873 ستار"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624470000000C~20260327162447.0000000\"",
            "Product": "13/911/30/3",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624470000000C~20260327162447.0000000\"",
                    "Product": "13/911/30/3",
                    "Language": "AR",
                    "ProductDescription": "Pendluque 911/3 Inch Star"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624470000000C~20260327162447.0000000\"",
                    "Product": "13/911/30/3",
                    "Language": "EN",
                    "ProductDescription": "مشط 3 / 911 ستار"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624470000000C~20260327162447.0000000\"",
            "Product": "14/16/50/33",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624470000000C~20260327162447.0000000\"",
                    "Product": "14/16/50/33",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1050/16 mm. ٍ Star"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624470000000C~20260327162447.0000000\"",
                    "Product": "14/16/50/33",
                    "Language": "EN",
                    "ProductDescription": "حب 1050/16 ستار"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624470000000C~20260327162447.0000000\"",
            "Product": "14/18/50/33",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624470000000C~20260327162447.0000000\"",
                    "Product": "14/18/50/33",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1050/18 mm Star"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624470000000C~20260327162447.0000000\"",
                    "Product": "14/18/50/33",
                    "Language": "EN",
                    "ProductDescription": "حب 1050/18 ستار"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624460000000C~20260327162446.0000000\"",
            "Product": "14/611/30/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624460000000C~20260327162446.0000000\"",
                    "Product": "14/611/30/333",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 611/3 Inch Star"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624460000000C~20260327162446.0000000\"",
                    "Product": "14/611/30/333",
                    "Language": "EN",
                    "ProductDescription": "عقله 3/611 بوصه ستار"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624460000000C~20260327162446.0000000\"",
            "Product": "14/611/30/3333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624460000000C~20260327162446.0000000\"",
                    "Product": "14/611/30/3333",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 611 /3 Inch Star"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624460000000C~20260327162446.0000000\"",
                    "Product": "14/611/30/3333",
                    "Language": "EN",
                    "ProductDescription": "عقلة 611/3 بوصة ستار"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624460000000C~20260327162446.0000000\"",
            "Product": "14/611/40/33",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624460000000C~20260327162446.0000000\"",
                    "Product": "14/611/40/33",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 611/4 Inch Star"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624460000000C~20260327162446.0000000\"",
                    "Product": "14/611/40/33",
                    "Language": "EN",
                    "ProductDescription": "عقله 4/611 بوصه ستار"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624450000000C~20260327162445.0000000\"",
            "Product": "14/611/60/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624450000000C~20260327162445.0000000\"",
                    "Product": "14/611/60/333",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 611/6 Inch Star"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624450000000C~20260327162445.0000000\"",
                    "Product": "14/611/60/333",
                    "Language": "EN",
                    "ProductDescription": "عقله 6/611 بوصه ستار"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624450000000C~20260327162445.0000000\"",
            "Product": "14/681/30/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624450000000C~20260327162445.0000000\"",
                    "Product": "14/681/30/333",
                    "Language": "AR",
                    "ProductDescription": "عقلة 3/681 ستار"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624450000000C~20260327162445.0000000\"",
                    "Product": "14/681/30/333",
                    "Language": "EN",
                    "ProductDescription": "عقلة 3/681 ستار"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624450000000C~20260327162445.0000000\"",
            "Product": "14/873/20/33",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624450000000C~20260327162445.0000000\"",
                    "Product": "14/873/20/33",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 873 /2 Inch Star"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624450000000C~20260327162445.0000000\"",
                    "Product": "14/873/20/33",
                    "Language": "EN",
                    "ProductDescription": "لوزه 2/873 بوصه ستار"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624450000000C~20260327162445.0000000\"",
            "Product": "14/873/25/33",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624450000000C~20260327162445.0000000\"",
                    "Product": "14/873/25/33",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 873 /2.5 Inch Star"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624450000000C~20260327162445.0000000\"",
                    "Product": "14/873/25/33",
                    "Language": "EN",
                    "ProductDescription": "لوزه 2.5/873 بوصه ستار"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624450000000C~20260327162445.0000000\"",
            "Product": "14/873/30/3333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624450000000C~20260327162445.0000000\"",
                    "Product": "14/873/30/3333",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 873 /3 Inch Star"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624450000000C~20260327162445.0000000\"",
                    "Product": "14/873/30/3333",
                    "Language": "EN",
                    "ProductDescription": "لوزه 3/873 بوصه ستار"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624440000000C~20260327162444.0000000\"",
            "Product": "14/911/25/33",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624440000000C~20260327162444.0000000\"",
                    "Product": "14/911/25/33",
                    "Language": "AR",
                    "ProductDescription": "PENDLUQUE 911 /2.5 Inch Star"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624440000000C~20260327162444.0000000\"",
                    "Product": "14/911/25/33",
                    "Language": "EN",
                    "ProductDescription": "مشط 2.5/911 بوصه ستار"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603151325020000000C~20260315132502.0000000\"",
            "Product": "15/0508/730/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603151325020000000C~20260315132502.0000000\"",
                    "Product": "15/0508/730/6",
                    "Language": "AR",
                    "ProductDescription": "دبوس 508/3 بالكرة 30 مل موحد"
                },
                {
                    "@odata.etag": "W/\"SADL-202603151325020000000C~20260315132502.0000000\"",
                    "Product": "15/0508/730/6",
                    "Language": "EN",
                    "ProductDescription": "دبوس 508/3 بالكرة 30 مل موحد"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703350000000C~20260326170335.0000000\"",
            "Product": "15/10/52/5555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703350000000C~20260326170335.0000000\"",
                    "Product": "15/10/52/5555",
                    "Language": "AR",
                    "ProductDescription": "BEAD 1502/10 MM. Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703350000000C~20260326170335.0000000\"",
                    "Product": "15/10/52/5555",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1502/10 مم درجة Rainbow"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624440000000C~20260327162444.0000000\"",
            "Product": "15/10/52/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624440000000C~20260327162444.0000000\"",
                    "Product": "15/10/52/6",
                    "Language": "AR",
                    "ProductDescription": "BEAD 1502 / 10 MM ( ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624440000000C~20260327162444.0000000\"",
                    "Product": "15/10/52/6",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1502 / 10 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703340000000C~20260326170334.0000000\"",
            "Product": "15/10/52/66",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703340000000C~20260326170334.0000000\"",
                    "Product": "15/10/52/66",
                    "Language": "AR",
                    "ProductDescription": "Bead 1502/10 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703340000000C~20260326170334.0000000\"",
                    "Product": "15/10/52/66",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1502/10  مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703340000000C~20260326170334.0000000\"",
            "Product": "15/10/52/666",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703340000000C~20260326170334.0000000\"",
                    "Product": "15/10/52/666",
                    "Language": "AR",
                    "ProductDescription": "Bead 1502/10 mm Almazza(New Packing)"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703340000000C~20260326170334.0000000\"",
                    "Product": "15/10/52/666",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1502/10مم موحدة تعبئة جديدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624440000000C~20260327162444.0000000\"",
            "Product": "15/10/53/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624440000000C~20260327162444.0000000\"",
                    "Product": "15/10/53/6",
                    "Language": "AR",
                    "ProductDescription": "BEAD 1503/10 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624440000000C~20260327162444.0000000\"",
                    "Product": "15/10/53/6",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1503/10 بيضاوى درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703330000000C~20260326170333.0000000\"",
            "Product": "15/10/56/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703330000000C~20260326170333.0000000\"",
                    "Product": "15/10/56/6",
                    "Language": "AR",
                    "ProductDescription": "فاصل 10/1506 موحدة"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703330000000C~20260326170333.0000000\"",
                    "Product": "15/10/56/6",
                    "Language": "EN",
                    "ProductDescription": "فاصل 10/1506 موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624440000000C~20260327162444.0000000\"",
            "Product": "15/106/5/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624440000000C~20260327162444.0000000\"",
                    "Product": "15/106/5/6",
                    "Language": "AR",
                    "ProductDescription": "Bead Shahid 106/50 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624440000000C~20260327162444.0000000\"",
                    "Product": "15/106/5/6",
                    "Language": "EN",
                    "ProductDescription": "شاهد سبحة 5 / 106 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624430000000C~20260327162443.0000000\"",
            "Product": "15/12/1020/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624430000000C~20260327162443.0000000\"",
                    "Product": "15/12/1020/555",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1020 / 12 mm rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624430000000C~20260327162443.0000000\"",
                    "Product": "15/12/1020/555",
                    "Language": "EN",
                    "ProductDescription": "حب 12/1020 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703320000000C~20260326170332.0000000\"",
            "Product": "15/12/1020/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703320000000C~20260326170332.0000000\"",
                    "Product": "15/12/1020/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1020 / 12 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703320000000C~20260326170332.0000000\"",
                    "Product": "15/12/1020/6",
                    "Language": "EN",
                    "ProductDescription": "حب 12/1020 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624430000000C~20260327162443.0000000\"",
            "Product": "15/12/50/5",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624430000000C~20260327162443.0000000\"",
                    "Product": "15/12/50/5",
                    "Language": "AR",
                    "ProductDescription": "حب 12/1050 درجة RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624430000000C~20260327162443.0000000\"",
                    "Product": "15/12/50/5",
                    "Language": "EN",
                    "ProductDescription": "حب 12/1050 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703320000000C~20260326170332.0000000\"",
            "Product": "15/12/50/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703320000000C~20260326170332.0000000\"",
                    "Product": "15/12/50/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1050 / 12 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703320000000C~20260326170332.0000000\"",
                    "Product": "15/12/50/6",
                    "Language": "EN",
                    "ProductDescription": "حب 12/1050 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703310000000C~20260326170331.0000000\"",
            "Product": "15/12/52/5555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703310000000C~20260326170331.0000000\"",
                    "Product": "15/12/52/5555",
                    "Language": "AR",
                    "ProductDescription": "BEAD 1502/12 RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703310000000C~20260326170331.0000000\"",
                    "Product": "15/12/52/5555",
                    "Language": "EN",
                    "ProductDescription": "سبحة 12/1502 Rinbow"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703310000000C~20260326170331.0000000\"",
            "Product": "15/12/52/66",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703310000000C~20260326170331.0000000\"",
                    "Product": "15/12/52/66",
                    "Language": "AR",
                    "ProductDescription": "Bead 1502/12 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703310000000C~20260326170331.0000000\"",
                    "Product": "15/12/52/66",
                    "Language": "EN",
                    "ProductDescription": "سبحة 12/1502 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624420000000C~20260327162442.0000000\"",
            "Product": "15/12/53/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624420000000C~20260327162442.0000000\"",
                    "Product": "15/12/53/6",
                    "Language": "AR",
                    "ProductDescription": "BEAD 1503/12 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624420000000C~20260327162442.0000000\"",
                    "Product": "15/12/53/6",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1503/12 بيضاوى درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624420000000C~20260327162442.0000000\"",
            "Product": "15/12/54/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624420000000C~20260327162442.0000000\"",
                    "Product": "15/12/54/6",
                    "Language": "AR",
                    "ProductDescription": "BEAD 1504/12 MM(Almazza )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624420000000C~20260327162442.0000000\"",
                    "Product": "15/12/54/6",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1504/12 بيضاوى درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624420000000C~20260327162442.0000000\"",
            "Product": "15/12/80/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624420000000C~20260327162442.0000000\"",
                    "Product": "15/12/80/333",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080/12 MM L.COLLECTION"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624420000000C~20260327162442.0000000\"",
                    "Product": "15/12/80/333",
                    "Language": "EN",
                    "ProductDescription": "حب 1080/12 مم L.COLLECTION"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703300000000C~20260326170330.0000000\"",
            "Product": "15/12/80/5555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703300000000C~20260326170330.0000000\"",
                    "Product": "15/12/80/5555",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1080 / 12 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703300000000C~20260326170330.0000000\"",
                    "Product": "15/12/80/5555",
                    "Language": "EN",
                    "ProductDescription": "حب 1080/12 مم  RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624420000000C~20260327162442.0000000\"",
            "Product": "15/12/80/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624420000000C~20260327162442.0000000\"",
                    "Product": "15/12/80/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080/12 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624420000000C~20260327162442.0000000\"",
                    "Product": "15/12/80/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1080/12مم درجة  موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624410000000C~20260327162441.0000000\"",
            "Product": "15/12/82/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624410000000C~20260327162441.0000000\"",
                    "Product": "15/12/82/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1082/12 MM ( ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624410000000C~20260327162441.0000000\"",
                    "Product": "15/12/82/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1082/12 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703290000000C~20260326170329.0000000\"",
            "Product": "15/14/1006/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703290000000C~20260326170329.0000000\"",
                    "Product": "15/14/1006/6",
                    "Language": "AR",
                    "ProductDescription": "Rosita 1006/14 mm. ALmazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703290000000C~20260326170329.0000000\"",
                    "Product": "15/14/1006/6",
                    "Language": "EN",
                    "ProductDescription": "وردة 1006/14 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703290000000C~20260326170329.0000000\"",
            "Product": "15/14/1020/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703290000000C~20260326170329.0000000\"",
                    "Product": "15/14/1020/555",
                    "Language": "AR",
                    "ProductDescription": "حب 14/1020 درجة RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703290000000C~20260326170329.0000000\"",
                    "Product": "15/14/1020/555",
                    "Language": "EN",
                    "ProductDescription": "حب 14/1020 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703290000000C~20260326170329.0000000\"",
            "Product": "15/14/1020/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703290000000C~20260326170329.0000000\"",
                    "Product": "15/14/1020/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1020 / 14 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703290000000C~20260326170329.0000000\"",
                    "Product": "15/14/1020/6",
                    "Language": "EN",
                    "ProductDescription": "حب 14/1020 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703290000000C~20260326170329.0000000\"",
            "Product": "15/14/1021/5",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703290000000C~20260326170329.0000000\"",
                    "Product": "15/14/1021/5",
                    "Language": "AR",
                    "ProductDescription": "حب 14/1021 درجه RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703290000000C~20260326170329.0000000\"",
                    "Product": "15/14/1021/5",
                    "Language": "EN",
                    "ProductDescription": "حب 14/1021 درجه RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703280000000C~20260326170328.0000000\"",
            "Product": "15/14/1021/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703280000000C~20260326170328.0000000\"",
                    "Product": "15/14/1021/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1021 / 14 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703280000000C~20260326170328.0000000\"",
                    "Product": "15/14/1021/6",
                    "Language": "EN",
                    "ProductDescription": "حب 14/1021 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624400000000C~20260327162440.0000000\"",
            "Product": "15/14/20/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624400000000C~20260327162440.0000000\"",
                    "Product": "15/14/20/6",
                    "Language": "AR",
                    "ProductDescription": "Square 2020/14 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624400000000C~20260327162440.0000000\"",
                    "Product": "15/14/20/6",
                    "Language": "EN",
                    "ProductDescription": "حب 2020/14 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703280000000C~20260326170328.0000000\"",
            "Product": "15/14/24/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703280000000C~20260326170328.0000000\"",
                    "Product": "15/14/24/6",
                    "Language": "AR",
                    "ProductDescription": "Square 2024/14 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703280000000C~20260326170328.0000000\"",
                    "Product": "15/14/24/6",
                    "Language": "EN",
                    "ProductDescription": "حب 14 /2024 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624400000000C~20260327162440.0000000\"",
            "Product": "15/14/31/2",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624400000000C~20260327162440.0000000\"",
                    "Product": "15/14/31/2",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON   1031 / 14   MM   2ND."
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624400000000C~20260327162440.0000000\"",
                    "Product": "15/14/31/2",
                    "Language": "EN",
                    "ProductDescription": "حب 14 / 1031 ثاني"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703270000000C~20260326170327.0000000\"",
            "Product": "15/14/31/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703270000000C~20260326170327.0000000\"",
                    "Product": "15/14/31/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon1031 / 14 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703270000000C~20260326170327.0000000\"",
                    "Product": "15/14/31/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1031/14 درجه موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624400000000C~20260327162440.0000000\"",
            "Product": "15/14/32/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624400000000C~20260327162440.0000000\"",
                    "Product": "15/14/32/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1032/14 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624400000000C~20260327162440.0000000\"",
                    "Product": "15/14/32/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1032/14 درجه موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624400000000C~20260327162440.0000000\"",
            "Product": "15/14/50/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624400000000C~20260327162440.0000000\"",
                    "Product": "15/14/50/333",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1050/14 mm L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624400000000C~20260327162440.0000000\"",
                    "Product": "15/14/50/333",
                    "Language": "EN",
                    "ProductDescription": "حب 1050/14 L.collection"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703260000000C~20260326170326.0000000\"",
            "Product": "15/14/50/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703260000000C~20260326170326.0000000\"",
                    "Product": "15/14/50/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1050/14 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703260000000C~20260326170326.0000000\"",
                    "Product": "15/14/50/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1050/14 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624390000000C~20260327162439.0000000\"",
            "Product": "15/14/52/2",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624390000000C~20260327162439.0000000\"",
                    "Product": "15/14/52/2",
                    "Language": "AR",
                    "ProductDescription": "BEAD 1502 / 14 MM Star"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624390000000C~20260327162439.0000000\"",
                    "Product": "15/14/52/2",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1502 / 14 مم ستار"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703260000000C~20260326170326.0000000\"",
            "Product": "15/14/52/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703260000000C~20260326170326.0000000\"",
                    "Product": "15/14/52/555",
                    "Language": "AR",
                    "ProductDescription": "BEAD  1502/14 Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703260000000C~20260326170326.0000000\"",
                    "Product": "15/14/52/555",
                    "Language": "EN",
                    "ProductDescription": "سبحة 14 /1502 Rainbow"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703260000000C~20260326170326.0000000\"",
            "Product": "15/14/52/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703260000000C~20260326170326.0000000\"",
                    "Product": "15/14/52/6",
                    "Language": "AR",
                    "ProductDescription": "Bead 1502/14 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703260000000C~20260326170326.0000000\"",
                    "Product": "15/14/52/6",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1502 / 14 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624390000000C~20260327162439.0000000\"",
            "Product": "15/14/53/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624390000000C~20260327162439.0000000\"",
                    "Product": "15/14/53/6",
                    "Language": "AR",
                    "ProductDescription": "Bead 1503/14 MM ( ALMAZZA)"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624390000000C~20260327162439.0000000\"",
                    "Product": "15/14/53/6",
                    "Language": "EN",
                    "ProductDescription": "سبحة 14 /1503 بيضاوي درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624390000000C~20260327162439.0000000\"",
            "Product": "15/14/54/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624390000000C~20260327162439.0000000\"",
                    "Product": "15/14/54/6",
                    "Language": "AR",
                    "ProductDescription": "Bead 1504/14 MM ( ALMAZZA)"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624390000000C~20260327162439.0000000\"",
                    "Product": "15/14/54/6",
                    "Language": "EN",
                    "ProductDescription": "سبحة 14 /1504 بيضاوي درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624380000000C~20260327162438.0000000\"",
            "Product": "15/14/80/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624380000000C~20260327162438.0000000\"",
                    "Product": "15/14/80/333",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1080 / 14 mm L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624380000000C~20260327162438.0000000\"",
                    "Product": "15/14/80/333",
                    "Language": "EN",
                    "ProductDescription": "L.Collection حب 1080 / 14 مم"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703240000000C~20260326170324.0000000\"",
            "Product": "15/14/80/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703240000000C~20260326170324.0000000\"",
                    "Product": "15/14/80/555",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080 / 14 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703240000000C~20260326170324.0000000\"",
                    "Product": "15/14/80/555",
                    "Language": "EN",
                    "ProductDescription": "حب 14/1080 مم  RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703240000000C~20260326170324.0000000\"",
            "Product": "15/14/80/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703240000000C~20260326170324.0000000\"",
                    "Product": "15/14/80/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080/14 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703240000000C~20260326170324.0000000\"",
                    "Product": "15/14/80/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1080 / 14 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703240000000C~20260326170324.0000000\"",
            "Product": "15/14/80/699",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703240000000C~20260326170324.0000000\"",
                    "Product": "15/14/80/699",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1080 / 14 MM ( ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703240000000C~20260326170324.0000000\"",
                    "Product": "15/14/80/699",
                    "Language": "EN",
                    "ProductDescription": "حب 1080 / 14 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703240000000C~20260326170324.0000000\"",
            "Product": "15/14/81/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703240000000C~20260326170324.0000000\"",
                    "Product": "15/14/81/555",
                    "Language": "AR",
                    "ProductDescription": "حب 14/1081 RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703240000000C~20260326170324.0000000\"",
                    "Product": "15/14/81/555",
                    "Language": "EN",
                    "ProductDescription": "حب 14/1081 RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624370000000C~20260327162437.0000000\"",
            "Product": "15/14/81/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624370000000C~20260327162437.0000000\"",
                    "Product": "15/14/81/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1081 / 14 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624370000000C~20260327162437.0000000\"",
                    "Product": "15/14/81/6",
                    "Language": "EN",
                    "ProductDescription": "حب 14/1081 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703230000000C~20260326170323.0000000\"",
            "Product": "15/14/82/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703230000000C~20260326170323.0000000\"",
                    "Product": "15/14/82/555",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1082 / 14 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703230000000C~20260326170323.0000000\"",
                    "Product": "15/14/82/555",
                    "Language": "EN",
                    "ProductDescription": "حب 1082 / 14 مم درجة Rainbow"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703230000000C~20260326170323.0000000\"",
            "Product": "15/14/82/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703230000000C~20260326170323.0000000\"",
                    "Product": "15/14/82/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1082 / 14 MM ( Almazza )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703230000000C~20260326170323.0000000\"",
                    "Product": "15/14/82/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1082 / 14 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624370000000C~20260327162437.0000000\"",
            "Product": "15/14/82/61",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624370000000C~20260327162437.0000000\"",
                    "Product": "15/14/82/61",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1082 / 14 mm Almazza - No Holes"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624370000000C~20260327162437.0000000\"",
                    "Product": "15/14/82/61",
                    "Language": "EN",
                    "ProductDescription": "حب 1082/14 مم درجة موحدة بدون ابرة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624370000000C~20260327162437.0000000\"",
            "Product": "15/14/88/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624370000000C~20260327162437.0000000\"",
                    "Product": "15/14/88/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1088/14 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624370000000C~20260327162437.0000000\"",
                    "Product": "15/14/88/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1088/14 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703220000000C~20260326170322.0000000\"",
            "Product": "15/16/1020/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703220000000C~20260326170322.0000000\"",
                    "Product": "15/16/1020/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1020 / 16 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703220000000C~20260326170322.0000000\"",
                    "Product": "15/16/1020/6",
                    "Language": "EN",
                    "ProductDescription": "حب 16/1020 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624350000000C~20260327162435.0000000\"",
            "Product": "15/16/20/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624350000000C~20260327162435.0000000\"",
                    "Product": "15/16/20/6",
                    "Language": "AR",
                    "ProductDescription": "Square 2020/16 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624350000000C~20260327162435.0000000\"",
                    "Product": "15/16/20/6",
                    "Language": "EN",
                    "ProductDescription": "حب 2020 / 16 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703210000000C~20260326170321.0000000\"",
            "Product": "15/16/24/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703210000000C~20260326170321.0000000\"",
                    "Product": "15/16/24/333",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 2024 / 16 MM L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703210000000C~20260326170321.0000000\"",
                    "Product": "15/16/24/333",
                    "Language": "EN",
                    "ProductDescription": "حب 2024/16 درجة L.COLLECTION"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703210000000C~20260326170321.0000000\"",
            "Product": "15/16/24/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703210000000C~20260326170321.0000000\"",
                    "Product": "15/16/24/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 2024 / 16 MM ( ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703210000000C~20260326170321.0000000\"",
                    "Product": "15/16/24/6",
                    "Language": "EN",
                    "ProductDescription": "حب16 /2024  درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624340000000C~20260327162434.0000000\"",
            "Product": "15/16/50/5",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624340000000C~20260327162434.0000000\"",
                    "Product": "15/16/50/5",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1050/16 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624340000000C~20260327162434.0000000\"",
                    "Product": "15/16/50/5",
                    "Language": "EN",
                    "ProductDescription": "حب 16/1050 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703190000000C~20260326170319.0000000\"",
            "Product": "15/16/50/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703190000000C~20260326170319.0000000\"",
                    "Product": "15/16/50/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1050 / 16 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703190000000C~20260326170319.0000000\"",
                    "Product": "15/16/50/6",
                    "Language": "EN",
                    "ProductDescription": "حب 16/1050 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703190000000C~20260326170319.0000000\"",
            "Product": "15/16/52/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703190000000C~20260326170319.0000000\"",
                    "Product": "15/16/52/555",
                    "Language": "AR",
                    "ProductDescription": "BEAD  1502/16 Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703190000000C~20260326170319.0000000\"",
                    "Product": "15/16/52/555",
                    "Language": "EN",
                    "ProductDescription": "Rainbow سبحة 1502/16"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703190000000C~20260326170319.0000000\"",
            "Product": "15/16/52/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703190000000C~20260326170319.0000000\"",
                    "Product": "15/16/52/6",
                    "Language": "AR",
                    "ProductDescription": "Bead 1502/16 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703190000000C~20260326170319.0000000\"",
                    "Product": "15/16/52/6",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1502/16   موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624340000000C~20260327162434.0000000\"",
            "Product": "15/16/53/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624340000000C~20260327162434.0000000\"",
                    "Product": "15/16/53/555",
                    "Language": "AR",
                    "ProductDescription": "BEAD 1503/16 MM Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624340000000C~20260327162434.0000000\"",
                    "Product": "15/16/53/555",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1503/16 بيضاوى درجة RAIN"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624340000000C~20260327162434.0000000\"",
            "Product": "15/16/53/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624340000000C~20260327162434.0000000\"",
                    "Product": "15/16/53/6",
                    "Language": "AR",
                    "ProductDescription": "BEAD 1503/16 MM(Almazza )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624340000000C~20260327162434.0000000\"",
                    "Product": "15/16/53/6",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1503/16 بيضاوى درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624330000000C~20260327162433.0000000\"",
            "Product": "15/16/54/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624330000000C~20260327162433.0000000\"",
                    "Product": "15/16/54/6",
                    "Language": "AR",
                    "ProductDescription": "BEAD 1504/16 MM(Almazza )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624330000000C~20260327162433.0000000\"",
                    "Product": "15/16/54/6",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1504/16 بيضاوى درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703180000000C~20260326170318.0000000\"",
            "Product": "15/16/80/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703180000000C~20260326170318.0000000\"",
                    "Product": "15/16/80/555",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1080/16 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703180000000C~20260326170318.0000000\"",
                    "Product": "15/16/80/555",
                    "Language": "EN",
                    "ProductDescription": "حب 16/1080 RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703180000000C~20260326170318.0000000\"",
            "Product": "15/16/80/61",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703180000000C~20260326170318.0000000\"",
                    "Product": "15/16/80/61",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080/16 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703180000000C~20260326170318.0000000\"",
                    "Product": "15/16/80/61",
                    "Language": "EN",
                    "ProductDescription": "حب 1080/ 16 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703180000000C~20260326170318.0000000\"",
            "Product": "15/16/82/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703180000000C~20260326170318.0000000\"",
                    "Product": "15/16/82/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1082/16 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703180000000C~20260326170318.0000000\"",
                    "Product": "15/16/82/6",
                    "Language": "EN",
                    "ProductDescription": "حب 16 /1082   درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624330000000C~20260327162433.0000000\"",
            "Product": "15/16/83/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624330000000C~20260327162433.0000000\"",
                    "Product": "15/16/83/333",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1083/16 mm L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624330000000C~20260327162433.0000000\"",
                    "Product": "15/16/83/333",
                    "Language": "EN",
                    "ProductDescription": "حب 1083/16 مم درجة L.COLLECTION"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624330000000C~20260327162433.0000000\"",
            "Product": "15/16/83/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624330000000C~20260327162433.0000000\"",
                    "Product": "15/16/83/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1083/16 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624330000000C~20260327162433.0000000\"",
                    "Product": "15/16/83/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1083/16 مم درجه موحده"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624330000000C~20260327162433.0000000\"",
            "Product": "15/16/84/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624330000000C~20260327162433.0000000\"",
                    "Product": "15/16/84/333",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1084/16 mm  L.collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624330000000C~20260327162433.0000000\"",
                    "Product": "15/16/84/333",
                    "Language": "EN",
                    "ProductDescription": "حب 16 /1084 درجة L.collection"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703170000000C~20260326170317.0000000\"",
            "Product": "15/16/84/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703170000000C~20260326170317.0000000\"",
                    "Product": "15/16/84/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1084/16 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703170000000C~20260326170317.0000000\"",
                    "Product": "15/16/84/6",
                    "Language": "EN",
                    "ProductDescription": "حب 16 /1084 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703160000000C~20260326170316.0000000\"",
            "Product": "15/170/40/0",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703160000000C~20260326170316.0000000\"",
                    "Product": "15/170/40/0",
                    "Language": "AR",
                    "ProductDescription": "PAPER WEIGHT 170/40"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703160000000C~20260326170316.0000000\"",
                    "Product": "15/170/40/0",
                    "Language": "EN",
                    "ProductDescription": "تقالة 40/170 مم"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624320000000C~20260327162432.0000000\"",
            "Product": "15/175/60/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624320000000C~20260327162432.0000000\"",
                    "Product": "15/175/60/64",
                    "Language": "AR",
                    "ProductDescription": "BALL 175/60 mm (Sectioned)Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624320000000C~20260327162432.0000000\"",
                    "Product": "15/175/60/64",
                    "Language": "EN",
                    "ProductDescription": "تقالة 175/60 درجة موحد باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624320000000C~20260327162432.0000000\"",
            "Product": "15/18/1020/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624320000000C~20260327162432.0000000\"",
                    "Product": "15/18/1020/555",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1020 / 18 mm rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624320000000C~20260327162432.0000000\"",
                    "Product": "15/18/1020/555",
                    "Language": "EN",
                    "ProductDescription": "حب 18/1020 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703160000000C~20260326170316.0000000\"",
            "Product": "15/18/1020/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703160000000C~20260326170316.0000000\"",
                    "Product": "15/18/1020/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1020 / 18 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703160000000C~20260326170316.0000000\"",
                    "Product": "15/18/1020/6",
                    "Language": "EN",
                    "ProductDescription": "حب 18/1020 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624320000000C~20260327162432.0000000\"",
            "Product": "15/18/20/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624320000000C~20260327162432.0000000\"",
                    "Product": "15/18/20/333",
                    "Language": "AR",
                    "ProductDescription": "Square 2020/18 mm L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624320000000C~20260327162432.0000000\"",
                    "Product": "15/18/20/333",
                    "Language": "EN",
                    "ProductDescription": "حب 2020 / 18 مم L.Collection"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703150000000C~20260326170315.0000000\"",
            "Product": "15/18/20/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703150000000C~20260326170315.0000000\"",
                    "Product": "15/18/20/555",
                    "Language": "AR",
                    "ProductDescription": "حب 18/2020 مم  RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703150000000C~20260326170315.0000000\"",
                    "Product": "15/18/20/555",
                    "Language": "EN",
                    "ProductDescription": "حب 18/2020 مم  RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703150000000C~20260326170315.0000000\"",
            "Product": "15/18/20/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703150000000C~20260326170315.0000000\"",
                    "Product": "15/18/20/6",
                    "Language": "AR",
                    "ProductDescription": "Square 2020/18 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703150000000C~20260326170315.0000000\"",
                    "Product": "15/18/20/6",
                    "Language": "EN",
                    "ProductDescription": "حب 2020 / 18 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624310000000C~20260327162431.0000000\"",
            "Product": "15/18/24/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624310000000C~20260327162431.0000000\"",
                    "Product": "15/18/24/333",
                    "Language": "AR",
                    "ProductDescription": "Square 2024/18 mm L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624310000000C~20260327162431.0000000\"",
                    "Product": "15/18/24/333",
                    "Language": "EN",
                    "ProductDescription": "حب 2024/18 درجة L.COLLECTION"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624300000000C~20260327162430.0000000\"",
            "Product": "15/18/24/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624300000000C~20260327162430.0000000\"",
                    "Product": "15/18/24/6",
                    "Language": "AR",
                    "ProductDescription": "Square 2024/18 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624300000000C~20260327162430.0000000\"",
                    "Product": "15/18/24/6",
                    "Language": "EN",
                    "ProductDescription": "حب18 /2024 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624300000000C~20260327162430.0000000\"",
            "Product": "15/18/50/5",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624300000000C~20260327162430.0000000\"",
                    "Product": "15/18/50/5",
                    "Language": "AR",
                    "ProductDescription": "حب 18/1050 درجة RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624300000000C~20260327162430.0000000\"",
                    "Product": "15/18/50/5",
                    "Language": "EN",
                    "ProductDescription": "حب 18/1050 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703140000000C~20260326170314.0000000\"",
            "Product": "15/18/50/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703140000000C~20260326170314.0000000\"",
                    "Product": "15/18/50/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1050 / 18 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703140000000C~20260326170314.0000000\"",
                    "Product": "15/18/50/6",
                    "Language": "EN",
                    "ProductDescription": "حب 18/1050 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703140000000C~20260326170314.0000000\"",
            "Product": "15/18/52/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703140000000C~20260326170314.0000000\"",
                    "Product": "15/18/52/555",
                    "Language": "AR",
                    "ProductDescription": "Bead 1502/18 MM ( Rainbow )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703140000000C~20260326170314.0000000\"",
                    "Product": "15/18/52/555",
                    "Language": "EN",
                    "ProductDescription": "سبحة  1502/18 درجة R ainbow"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624290000000C~20260327162429.0000000\"",
            "Product": "15/18/52/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624290000000C~20260327162429.0000000\"",
                    "Product": "15/18/52/6",
                    "Language": "AR",
                    "ProductDescription": "Bead 1502/18 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624290000000C~20260327162429.0000000\"",
                    "Product": "15/18/52/6",
                    "Language": "EN",
                    "ProductDescription": "سبحة  1502/18 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624290000000C~20260327162429.0000000\"",
            "Product": "15/18/53/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624290000000C~20260327162429.0000000\"",
                    "Product": "15/18/53/555",
                    "Language": "AR",
                    "ProductDescription": "BEAD 1503/18 Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624290000000C~20260327162429.0000000\"",
                    "Product": "15/18/53/555",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1503/18 بيضاوى درجة RAIN"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624290000000C~20260327162429.0000000\"",
            "Product": "15/18/53/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624290000000C~20260327162429.0000000\"",
                    "Product": "15/18/53/6",
                    "Language": "AR",
                    "ProductDescription": "BEAD 1503/18 MM(Almazza )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624290000000C~20260327162429.0000000\"",
                    "Product": "15/18/53/6",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1503/18 بيضاوى درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624280000000C~20260327162428.0000000\"",
            "Product": "15/18/54/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624280000000C~20260327162428.0000000\"",
                    "Product": "15/18/54/6",
                    "Language": "AR",
                    "ProductDescription": "BEAD 1504/18 MM(Almazza )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624280000000C~20260327162428.0000000\"",
                    "Product": "15/18/54/6",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1504/18 بيضاوى درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703130000000C~20260326170313.0000000\"",
            "Product": "15/18/80/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703130000000C~20260326170313.0000000\"",
                    "Product": "15/18/80/555",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080 / 18 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703130000000C~20260326170313.0000000\"",
                    "Product": "15/18/80/555",
                    "Language": "EN",
                    "ProductDescription": "حب 18/1080 مم  RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624280000000C~20260327162428.0000000\"",
            "Product": "15/18/80/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624280000000C~20260327162428.0000000\"",
                    "Product": "15/18/80/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080/18 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624280000000C~20260327162428.0000000\"",
                    "Product": "15/18/80/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1080 / 18 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703120000000C~20260326170312.0000000\"",
            "Product": "15/18/82/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703120000000C~20260326170312.0000000\"",
                    "Product": "15/18/82/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1082/18 MM ( ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703120000000C~20260326170312.0000000\"",
                    "Product": "15/18/82/6",
                    "Language": "EN",
                    "ProductDescription": "حب 18 /1082   درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624270000000C~20260327162427.0000000\"",
            "Product": "15/18/84/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624270000000C~20260327162427.0000000\"",
                    "Product": "15/18/84/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1084 / 18 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624270000000C~20260327162427.0000000\"",
                    "Product": "15/18/84/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1084/18 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703120000000C~20260326170312.0000000\"",
            "Product": "15/20/1006/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703120000000C~20260326170312.0000000\"",
                    "Product": "15/20/1006/6",
                    "Language": "AR",
                    "ProductDescription": "Rosita 1006/20 mm. Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703120000000C~20260326170312.0000000\"",
                    "Product": "15/20/1006/6",
                    "Language": "EN",
                    "ProductDescription": "وردة 1006/20 مم  درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703110000000C~20260326170311.0000000\"",
            "Product": "15/20/1020/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703110000000C~20260326170311.0000000\"",
                    "Product": "15/20/1020/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1020 / 20 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703110000000C~20260326170311.0000000\"",
                    "Product": "15/20/1020/6",
                    "Language": "EN",
                    "ProductDescription": "حب 20/1020 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624270000000C~20260327162427.0000000\"",
            "Product": "15/20/20/11",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624270000000C~20260327162427.0000000\"",
                    "Product": "15/20/20/11",
                    "Language": "AR",
                    "ProductDescription": "Square 2020/20 mm 1ST."
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624270000000C~20260327162427.0000000\"",
                    "Product": "15/20/20/11",
                    "Language": "EN",
                    "ProductDescription": "حب 2020 / 20 مم اول"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624270000000C~20260327162427.0000000\"",
            "Product": "15/20/20/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624270000000C~20260327162427.0000000\"",
                    "Product": "15/20/20/333",
                    "Language": "AR",
                    "ProductDescription": "Square 2020/20 mm L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624270000000C~20260327162427.0000000\"",
                    "Product": "15/20/20/333",
                    "Language": "EN",
                    "ProductDescription": "حب 20 / 2020 مم L.Collection"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703110000000C~20260326170311.0000000\"",
            "Product": "15/20/20/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703110000000C~20260326170311.0000000\"",
                    "Product": "15/20/20/555",
                    "Language": "AR",
                    "ProductDescription": "Octagon 2020 / 20 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703110000000C~20260326170311.0000000\"",
                    "Product": "15/20/20/555",
                    "Language": "EN",
                    "ProductDescription": "حب 2020 / 20 مم درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624270000000C~20260327162427.0000000\"",
            "Product": "15/20/20/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624270000000C~20260327162427.0000000\"",
                    "Product": "15/20/20/6",
                    "Language": "AR",
                    "ProductDescription": "Square 2020/20 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624270000000C~20260327162427.0000000\"",
                    "Product": "15/20/20/6",
                    "Language": "EN",
                    "ProductDescription": "حب 2020 / 20 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703100000000C~20260326170310.0000000\"",
            "Product": "15/20/20/66",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703100000000C~20260326170310.0000000\"",
                    "Product": "15/20/20/66",
                    "Language": "AR",
                    "ProductDescription": "Square 2020/20 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703100000000C~20260326170310.0000000\"",
                    "Product": "15/20/20/66",
                    "Language": "EN",
                    "ProductDescription": "حب 2020 / 20 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624260000000C~20260327162426.0000000\"",
            "Product": "15/20/24/21",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624260000000C~20260327162426.0000000\"",
                    "Product": "15/20/24/21",
                    "Language": "AR",
                    "ProductDescription": "Square 2024/20 mm 2ND."
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624260000000C~20260327162426.0000000\"",
                    "Product": "15/20/24/21",
                    "Language": "EN",
                    "ProductDescription": "حب  2024  /  20   مم   ثاني"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703100000000C~20260326170310.0000000\"",
            "Product": "15/20/24/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703100000000C~20260326170310.0000000\"",
                    "Product": "15/20/24/333",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 2024 / 20 mm L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703100000000C~20260326170310.0000000\"",
                    "Product": "15/20/24/333",
                    "Language": "EN",
                    "ProductDescription": "حب 2024/20 درجة L.COLLECTION"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624260000000C~20260327162426.0000000\"",
            "Product": "15/20/24/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624260000000C~20260327162426.0000000\"",
                    "Product": "15/20/24/6",
                    "Language": "AR",
                    "ProductDescription": "Square 2024/20 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624260000000C~20260327162426.0000000\"",
                    "Product": "15/20/24/6",
                    "Language": "EN",
                    "ProductDescription": "حب20 /2024   درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624260000000C~20260327162426.0000000\"",
            "Product": "15/20/31/21",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624260000000C~20260327162426.0000000\"",
                    "Product": "15/20/31/21",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1031 / 20 MM 2ND."
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624260000000C~20260327162426.0000000\"",
                    "Product": "15/20/31/21",
                    "Language": "EN",
                    "ProductDescription": "حب 1031 / 20 مم ثاني"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624260000000C~20260327162426.0000000\"",
            "Product": "15/20/31/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624260000000C~20260327162426.0000000\"",
                    "Product": "15/20/31/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1031/20 MM ALMAZZA"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624260000000C~20260327162426.0000000\"",
                    "Product": "15/20/31/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1031 /20مم (موحدة)"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624250000000C~20260327162425.0000000\"",
            "Product": "15/20/32/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624250000000C~20260327162425.0000000\"",
                    "Product": "15/20/32/333",
                    "Language": "AR",
                    "ProductDescription": "حب 20/1032 L.COLLECTION"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624250000000C~20260327162425.0000000\"",
                    "Product": "15/20/32/333",
                    "Language": "EN",
                    "ProductDescription": "حب 20/1032 L.COLLECTION"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703080000000C~20260326170308.0000000\"",
            "Product": "15/20/32/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703080000000C~20260326170308.0000000\"",
                    "Product": "15/20/32/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1032/20 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703080000000C~20260326170308.0000000\"",
                    "Product": "15/20/32/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1032 / 20 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624250000000C~20260327162425.0000000\"",
            "Product": "15/20/50/5",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624250000000C~20260327162425.0000000\"",
                    "Product": "15/20/50/5",
                    "Language": "AR",
                    "ProductDescription": "حب 20/1050 درجة RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624250000000C~20260327162425.0000000\"",
                    "Product": "15/20/50/5",
                    "Language": "EN",
                    "ProductDescription": "حب 20/1050 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703080000000C~20260326170308.0000000\"",
            "Product": "15/20/50/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703080000000C~20260326170308.0000000\"",
                    "Product": "15/20/50/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1050 / 20 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703080000000C~20260326170308.0000000\"",
                    "Product": "15/20/50/6",
                    "Language": "EN",
                    "ProductDescription": "حب 20/1050 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624250000000C~20260327162425.0000000\"",
            "Product": "15/20/52/3408",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624250000000C~20260327162425.0000000\"",
                    "Product": "15/20/52/3408",
                    "Language": "AR",
                    "ProductDescription": "Bead 1502/20 mm Rahaya"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624250000000C~20260327162425.0000000\"",
                    "Product": "15/20/52/3408",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1502/20 مم ( رحايا )"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703070000000C~20260326170307.0000000\"",
            "Product": "15/20/52/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703070000000C~20260326170307.0000000\"",
                    "Product": "15/20/52/555",
                    "Language": "AR",
                    "ProductDescription": "Bead 1502/20 Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703070000000C~20260326170307.0000000\"",
                    "Product": "15/20/52/555",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1502/20 مم   درجة Rainbow"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703070000000C~20260326170307.0000000\"",
            "Product": "15/20/52/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703070000000C~20260326170307.0000000\"",
                    "Product": "15/20/52/6",
                    "Language": "AR",
                    "ProductDescription": "Bead 1502/20 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703070000000C~20260326170307.0000000\"",
                    "Product": "15/20/52/6",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1502/20 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624250000000C~20260327162425.0000000\"",
            "Product": "15/20/53/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624250000000C~20260327162425.0000000\"",
                    "Product": "15/20/53/6",
                    "Language": "AR",
                    "ProductDescription": "Bead 1503/20 ALMAZAA"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624250000000C~20260327162425.0000000\"",
                    "Product": "15/20/53/6",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1503/20 بيضاوي درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624240000000C~20260327162424.0000000\"",
            "Product": "15/20/54/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624240000000C~20260327162424.0000000\"",
                    "Product": "15/20/54/6",
                    "Language": "AR",
                    "ProductDescription": "Bead 1504/20 ALMAZAA"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624240000000C~20260327162424.0000000\"",
                    "Product": "15/20/54/6",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1504/20 بيضاوي درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703070000000C~20260326170307.0000000\"",
            "Product": "15/20/80/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703070000000C~20260326170307.0000000\"",
                    "Product": "15/20/80/555",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080/20 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703070000000C~20260326170307.0000000\"",
                    "Product": "15/20/80/555",
                    "Language": "EN",
                    "ProductDescription": "حب 20/1080 RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624240000000C~20260327162424.0000000\"",
            "Product": "15/20/80/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624240000000C~20260327162424.0000000\"",
                    "Product": "15/20/80/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080/20 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624240000000C~20260327162424.0000000\"",
                    "Product": "15/20/80/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1080 / 20 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624230000000C~20260327162423.0000000\"",
            "Product": "15/20/82/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624230000000C~20260327162423.0000000\"",
                    "Product": "15/20/82/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1082/20 MM ( ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624230000000C~20260327162423.0000000\"",
                    "Product": "15/20/82/6",
                    "Language": "EN",
                    "ProductDescription": "حب 20 /1082 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624230000000C~20260327162423.0000000\"",
            "Product": "15/20/84/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624230000000C~20260327162423.0000000\"",
                    "Product": "15/20/84/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1084 / 20 MM ( ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624230000000C~20260327162423.0000000\"",
                    "Product": "15/20/84/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1084/20 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624220000000C~20260327162422.0000000\"",
            "Product": "15/22/1020/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624220000000C~20260327162422.0000000\"",
                    "Product": "15/22/1020/555",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1020 / 22 mm rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624220000000C~20260327162422.0000000\"",
                    "Product": "15/22/1020/555",
                    "Language": "EN",
                    "ProductDescription": "حب 22/1020 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703050000000C~20260326170305.0000000\"",
            "Product": "15/22/1020/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703050000000C~20260326170305.0000000\"",
                    "Product": "15/22/1020/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1020 / 22 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703050000000C~20260326170305.0000000\"",
                    "Product": "15/22/1020/6",
                    "Language": "EN",
                    "ProductDescription": "حب 22/1020 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624220000000C~20260327162422.0000000\"",
            "Product": "15/22/20/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624220000000C~20260327162422.0000000\"",
                    "Product": "15/22/20/333",
                    "Language": "AR",
                    "ProductDescription": "Square 2020/22 mm L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624220000000C~20260327162422.0000000\"",
                    "Product": "15/22/20/333",
                    "Language": "EN",
                    "ProductDescription": "حب 2020 / 22 مم L.Collection"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703050000000C~20260326170305.0000000\"",
            "Product": "15/22/20/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703050000000C~20260326170305.0000000\"",
                    "Product": "15/22/20/555",
                    "Language": "AR",
                    "ProductDescription": "Square 2020/22 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703050000000C~20260326170305.0000000\"",
                    "Product": "15/22/20/555",
                    "Language": "EN",
                    "ProductDescription": "حب 22 / 2020  مم  RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703050000000C~20260326170305.0000000\"",
            "Product": "15/22/20/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703050000000C~20260326170305.0000000\"",
                    "Product": "15/22/20/6",
                    "Language": "AR",
                    "ProductDescription": "Square 2020/22 mm ALmazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703050000000C~20260326170305.0000000\"",
                    "Product": "15/22/20/6",
                    "Language": "EN",
                    "ProductDescription": "حب 2020 / 22 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624220000000C~20260327162422.0000000\"",
            "Product": "15/22/24/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624220000000C~20260327162422.0000000\"",
                    "Product": "15/22/24/333",
                    "Language": "AR",
                    "ProductDescription": "Square 2024/22 mm L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624220000000C~20260327162422.0000000\"",
                    "Product": "15/22/24/333",
                    "Language": "EN",
                    "ProductDescription": "حب 2024 / 22 مم L.Collection"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703040000000C~20260326170304.0000000\"",
            "Product": "15/22/24/5",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703040000000C~20260326170304.0000000\"",
                    "Product": "15/22/24/5",
                    "Language": "AR",
                    "ProductDescription": "حب 22/2024 درجة RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703040000000C~20260326170304.0000000\"",
                    "Product": "15/22/24/5",
                    "Language": "EN",
                    "ProductDescription": "حب 22/2024 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624220000000C~20260327162422.0000000\"",
            "Product": "15/22/24/60",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624220000000C~20260327162422.0000000\"",
                    "Product": "15/22/24/60",
                    "Language": "AR",
                    "ProductDescription": "Square 2024/22 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624220000000C~20260327162422.0000000\"",
                    "Product": "15/22/24/60",
                    "Language": "EN",
                    "ProductDescription": "حب 2024 / 22 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703030000000C~20260326170303.0000000\"",
            "Product": "15/22/50/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703030000000C~20260326170303.0000000\"",
                    "Product": "15/22/50/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1050 / 22 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703030000000C~20260326170303.0000000\"",
                    "Product": "15/22/50/6",
                    "Language": "EN",
                    "ProductDescription": "حب 22/1050 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703030000000C~20260326170303.0000000\"",
            "Product": "15/22/80/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703030000000C~20260326170303.0000000\"",
                    "Product": "15/22/80/555",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080 / 22 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703030000000C~20260326170303.0000000\"",
                    "Product": "15/22/80/555",
                    "Language": "EN",
                    "ProductDescription": "حب 22/1080 درجه RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624210000000C~20260327162421.0000000\"",
            "Product": "15/22/80/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624210000000C~20260327162421.0000000\"",
                    "Product": "15/22/80/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080/22 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624210000000C~20260327162421.0000000\"",
                    "Product": "15/22/80/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1080 / 22 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703020000000C~20260326170302.0000000\"",
            "Product": "15/22/82/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703020000000C~20260326170302.0000000\"",
                    "Product": "15/22/82/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1082/22 MM ( ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703020000000C~20260326170302.0000000\"",
                    "Product": "15/22/82/6",
                    "Language": "EN",
                    "ProductDescription": "حب 22 /1082  درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624210000000C~20260327162421.0000000\"",
            "Product": "15/22/84/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624210000000C~20260327162421.0000000\"",
                    "Product": "15/22/84/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1084 / 22 MM ( ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624210000000C~20260327162421.0000000\"",
                    "Product": "15/22/84/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1084/22 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703020000000C~20260326170302.0000000\"",
            "Product": "15/22/90/55",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703020000000C~20260326170302.0000000\"",
                    "Product": "15/22/90/55",
                    "Language": "AR",
                    "ProductDescription": "Octagon Baccara 1090 /22 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703020000000C~20260326170302.0000000\"",
                    "Product": "15/22/90/55",
                    "Language": "EN",
                    "ProductDescription": "حب بكارة 22/1090 درجه RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703020000000C~20260326170302.0000000\"",
            "Product": "15/22/90/66",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703020000000C~20260326170302.0000000\"",
                    "Product": "15/22/90/66",
                    "Language": "AR",
                    "ProductDescription": "Octagon Baccara 1090 /22 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703020000000C~20260326170302.0000000\"",
                    "Product": "15/22/90/66",
                    "Language": "EN",
                    "ProductDescription": "حب بكارة 22/1090 درجه موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703020000000C~20260326170302.0000000\"",
            "Product": "15/24/1006/16",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703020000000C~20260326170302.0000000\"",
                    "Product": "15/24/1006/16",
                    "Language": "AR",
                    "ProductDescription": "ROSETTE 1006/24 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703020000000C~20260326170302.0000000\"",
                    "Product": "15/24/1006/16",
                    "Language": "EN",
                    "ProductDescription": "وردة 1006/24 درجة  موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703010000000C~20260326170301.0000000\"",
            "Product": "15/24/1020/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703010000000C~20260326170301.0000000\"",
                    "Product": "15/24/1020/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1020 / 24 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703010000000C~20260326170301.0000000\"",
                    "Product": "15/24/1020/6",
                    "Language": "EN",
                    "ProductDescription": "حب 24/1020 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624200000000C~20260327162420.0000000\"",
            "Product": "15/24/20/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624200000000C~20260327162420.0000000\"",
                    "Product": "15/24/20/555",
                    "Language": "AR",
                    "ProductDescription": "Square 2020/24 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624200000000C~20260327162420.0000000\"",
                    "Product": "15/24/20/555",
                    "Language": "EN",
                    "ProductDescription": "حب 24/2020 درجه RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624200000000C~20260327162420.0000000\"",
            "Product": "15/24/20/60",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624200000000C~20260327162420.0000000\"",
                    "Product": "15/24/20/60",
                    "Language": "AR",
                    "ProductDescription": "Square 2020/24 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624200000000C~20260327162420.0000000\"",
                    "Product": "15/24/20/60",
                    "Language": "EN",
                    "ProductDescription": "حب 2020 / 24 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703000000000C~20260326170300.0000000\"",
            "Product": "15/24/24/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703000000000C~20260326170300.0000000\"",
                    "Product": "15/24/24/333",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 2024 / 24 MM L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703000000000C~20260326170300.0000000\"",
                    "Product": "15/24/24/333",
                    "Language": "EN",
                    "ProductDescription": "حب 2024/24 درجة L.COLLECTION"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624190000000C~20260327162419.0000000\"",
            "Product": "15/24/24/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624190000000C~20260327162419.0000000\"",
                    "Product": "15/24/24/6",
                    "Language": "AR",
                    "ProductDescription": "Square 2024/24 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624190000000C~20260327162419.0000000\"",
                    "Product": "15/24/24/6",
                    "Language": "EN",
                    "ProductDescription": "حب24 /2024   درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624190000000C~20260327162419.0000000\"",
            "Product": "15/24/32/11",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624190000000C~20260327162419.0000000\"",
                    "Product": "15/24/32/11",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1032 / 24 MM 1ST."
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624190000000C~20260327162419.0000000\"",
                    "Product": "15/24/32/11",
                    "Language": "EN",
                    "ProductDescription": "حب 1032 / 24 مم اول"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261703000000000C~20260326170300.0000000\"",
            "Product": "15/24/32/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261703000000000C~20260326170300.0000000\"",
                    "Product": "15/24/32/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1032/24 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261703000000000C~20260326170300.0000000\"",
                    "Product": "15/24/32/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1032/24 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624190000000C~20260327162419.0000000\"",
            "Product": "15/24/50/5",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624190000000C~20260327162419.0000000\"",
                    "Product": "15/24/50/5",
                    "Language": "AR",
                    "ProductDescription": "حب 24/1050 درجة RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624190000000C~20260327162419.0000000\"",
                    "Product": "15/24/50/5",
                    "Language": "EN",
                    "ProductDescription": "حب 24/1050 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702590000000C~20260326170259.0000000\"",
            "Product": "15/24/50/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702590000000C~20260326170259.0000000\"",
                    "Product": "15/24/50/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1050 / 24 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702590000000C~20260326170259.0000000\"",
                    "Product": "15/24/50/6",
                    "Language": "EN",
                    "ProductDescription": "حب 24/1050 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702590000000C~20260326170259.0000000\"",
            "Product": "15/24/80/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702590000000C~20260326170259.0000000\"",
                    "Product": "15/24/80/555",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080 / 24 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702590000000C~20260326170259.0000000\"",
                    "Product": "15/24/80/555",
                    "Language": "EN",
                    "ProductDescription": "حب 24/1080مم  RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624190000000C~20260327162419.0000000\"",
            "Product": "15/24/80/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624190000000C~20260327162419.0000000\"",
                    "Product": "15/24/80/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080/24 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624190000000C~20260327162419.0000000\"",
                    "Product": "15/24/80/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1080 / 24 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624190000000C~20260327162419.0000000\"",
            "Product": "15/24/82/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624190000000C~20260327162419.0000000\"",
                    "Product": "15/24/82/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1082/24 MM ( ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624190000000C~20260327162419.0000000\"",
                    "Product": "15/24/82/6",
                    "Language": "EN",
                    "ProductDescription": "حب 24 /1082 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624180000000C~20260327162418.0000000\"",
            "Product": "15/24/83/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624180000000C~20260327162418.0000000\"",
                    "Product": "15/24/83/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1083/24 MM. (ALMAZZA)"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624180000000C~20260327162418.0000000\"",
                    "Product": "15/24/83/6",
                    "Language": "EN",
                    "ProductDescription": "حب 24 /1083 درجة موحـدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624180000000C~20260327162418.0000000\"",
            "Product": "15/26/1020/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624180000000C~20260327162418.0000000\"",
                    "Product": "15/26/1020/555",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1020 / 26 mm rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624180000000C~20260327162418.0000000\"",
                    "Product": "15/26/1020/555",
                    "Language": "EN",
                    "ProductDescription": "حب 26/1020 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702580000000C~20260326170258.0000000\"",
            "Product": "15/26/1020/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702580000000C~20260326170258.0000000\"",
                    "Product": "15/26/1020/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1020 / 26 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702580000000C~20260326170258.0000000\"",
                    "Product": "15/26/1020/6",
                    "Language": "EN",
                    "ProductDescription": "حب 26/1020 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624180000000C~20260327162418.0000000\"",
            "Product": "15/26/20/11",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624180000000C~20260327162418.0000000\"",
                    "Product": "15/26/20/11",
                    "Language": "AR",
                    "ProductDescription": "Square 2020/26 mm 1ST."
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624180000000C~20260327162418.0000000\"",
                    "Product": "15/26/20/11",
                    "Language": "EN",
                    "ProductDescription": "حب 2020 / 26 مم اول"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624170000000C~20260327162417.0000000\"",
            "Product": "15/26/20/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624170000000C~20260327162417.0000000\"",
                    "Product": "15/26/20/333",
                    "Language": "AR",
                    "ProductDescription": "Square 2020/26 mm L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624170000000C~20260327162417.0000000\"",
                    "Product": "15/26/20/333",
                    "Language": "EN",
                    "ProductDescription": "حب 2020 / 26 مم L.Collection"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624170000000C~20260327162417.0000000\"",
            "Product": "15/26/20/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624170000000C~20260327162417.0000000\"",
                    "Product": "15/26/20/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 2020 / 26 MM (ALMAZZA )."
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624170000000C~20260327162417.0000000\"",
                    "Product": "15/26/20/6",
                    "Language": "EN",
                    "ProductDescription": "حب 2020 / 26 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702570000000C~20260326170257.0000000\"",
            "Product": "15/26/24/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702570000000C~20260326170257.0000000\"",
                    "Product": "15/26/24/6",
                    "Language": "AR",
                    "ProductDescription": "Square 2024/26 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702570000000C~20260326170257.0000000\"",
                    "Product": "15/26/24/6",
                    "Language": "EN",
                    "ProductDescription": "حب 26 /2024 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702560000000C~20260326170256.0000000\"",
            "Product": "15/26/50/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702560000000C~20260326170256.0000000\"",
                    "Product": "15/26/50/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1050 / 26 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702560000000C~20260326170256.0000000\"",
                    "Product": "15/26/50/6",
                    "Language": "EN",
                    "ProductDescription": "حب 26/1050 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624160000000C~20260327162416.0000000\"",
            "Product": "15/26/80/12",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624160000000C~20260327162416.0000000\"",
                    "Product": "15/26/80/12",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1080 / 26 MM 1ST."
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624160000000C~20260327162416.0000000\"",
                    "Product": "15/26/80/12",
                    "Language": "EN",
                    "ProductDescription": "حب 1080 / 26 مم اول"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702550000000C~20260326170255.0000000\"",
            "Product": "15/26/80/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702550000000C~20260326170255.0000000\"",
                    "Product": "15/26/80/555",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080 / 26 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702550000000C~20260326170255.0000000\"",
                    "Product": "15/26/80/555",
                    "Language": "EN",
                    "ProductDescription": "حب 26/1080 درجه RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624160000000C~20260327162416.0000000\"",
            "Product": "15/26/80/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624160000000C~20260327162416.0000000\"",
                    "Product": "15/26/80/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080 / 26 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624160000000C~20260327162416.0000000\"",
                    "Product": "15/26/80/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1080 / 26 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624150000000C~20260327162415.0000000\"",
            "Product": "15/26/82/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624150000000C~20260327162415.0000000\"",
                    "Product": "15/26/82/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1082/26 MM ( ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624150000000C~20260327162415.0000000\"",
                    "Product": "15/26/82/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1082/26 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624150000000C~20260327162415.0000000\"",
            "Product": "15/26/84/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624150000000C~20260327162415.0000000\"",
                    "Product": "15/26/84/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1084 / 26 MM ( ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624150000000C~20260327162415.0000000\"",
                    "Product": "15/26/84/6",
                    "Language": "EN",
                    "ProductDescription": "حب 26 /1084 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702540000000C~20260326170254.0000000\"",
            "Product": "15/26/90/55",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702540000000C~20260326170254.0000000\"",
                    "Product": "15/26/90/55",
                    "Language": "AR",
                    "ProductDescription": "حب بكاراة 26/1090 درجه RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702540000000C~20260326170254.0000000\"",
                    "Product": "15/26/90/55",
                    "Language": "EN",
                    "ProductDescription": "حب بكاراة 26/1090 درجه RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702540000000C~20260326170254.0000000\"",
            "Product": "15/26/90/66",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702540000000C~20260326170254.0000000\"",
                    "Product": "15/26/90/66",
                    "Language": "AR",
                    "ProductDescription": "Octagon Baccara 1090 /26 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702540000000C~20260326170254.0000000\"",
                    "Product": "15/26/90/66",
                    "Language": "EN",
                    "ProductDescription": "حب بكاراة 26/1090 درجه موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702540000000C~20260326170254.0000000\"",
            "Product": "15/28/1020/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702540000000C~20260326170254.0000000\"",
                    "Product": "15/28/1020/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1020 / 28 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702540000000C~20260326170254.0000000\"",
                    "Product": "15/28/1020/6",
                    "Language": "EN",
                    "ProductDescription": "حب 28/1020 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624150000000C~20260327162415.0000000\"",
            "Product": "15/28/20/13",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624150000000C~20260327162415.0000000\"",
                    "Product": "15/28/20/13",
                    "Language": "AR",
                    "ProductDescription": "Square 2020/28 mm 1ST"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624150000000C~20260327162415.0000000\"",
                    "Product": "15/28/20/13",
                    "Language": "EN",
                    "ProductDescription": "حب 2020 / 28 مم اول"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624140000000C~20260327162414.0000000\"",
            "Product": "15/28/20/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624140000000C~20260327162414.0000000\"",
                    "Product": "15/28/20/333",
                    "Language": "AR",
                    "ProductDescription": "Square 2020/28 mm L.collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624140000000C~20260327162414.0000000\"",
                    "Product": "15/28/20/333",
                    "Language": "EN",
                    "ProductDescription": "حب 2020/28 L .COLLECTION"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702530000000C~20260326170253.0000000\"",
            "Product": "15/28/20/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702530000000C~20260326170253.0000000\"",
                    "Product": "15/28/20/555",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 2020 / 28 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702530000000C~20260326170253.0000000\"",
                    "Product": "15/28/20/555",
                    "Language": "EN",
                    "ProductDescription": "حب 28 / 2020  مم  RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624140000000C~20260327162414.0000000\"",
            "Product": "15/28/20/60",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624140000000C~20260327162414.0000000\"",
                    "Product": "15/28/20/60",
                    "Language": "AR",
                    "ProductDescription": "Square 2020 / 28 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624140000000C~20260327162414.0000000\"",
                    "Product": "15/28/20/60",
                    "Language": "EN",
                    "ProductDescription": "حب 2020 / 28 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702530000000C~20260326170253.0000000\"",
            "Product": "15/28/24/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702530000000C~20260326170253.0000000\"",
                    "Product": "15/28/24/333",
                    "Language": "AR",
                    "ProductDescription": "Square 2024/28 mm L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702530000000C~20260326170253.0000000\"",
                    "Product": "15/28/24/333",
                    "Language": "EN",
                    "ProductDescription": "حب 2024 / 28 مم L.Collection"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624140000000C~20260327162414.0000000\"",
            "Product": "15/28/24/60",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624140000000C~20260327162414.0000000\"",
                    "Product": "15/28/24/60",
                    "Language": "AR",
                    "ProductDescription": "Octagon 2024 / 28 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624140000000C~20260327162414.0000000\"",
                    "Product": "15/28/24/60",
                    "Language": "EN",
                    "ProductDescription": "حب 2024 / 28 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702520000000C~20260326170252.0000000\"",
            "Product": "15/28/50/5",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702520000000C~20260326170252.0000000\"",
                    "Product": "15/28/50/5",
                    "Language": "AR",
                    "ProductDescription": "حب 28/1050 درجة RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702520000000C~20260326170252.0000000\"",
                    "Product": "15/28/50/5",
                    "Language": "EN",
                    "ProductDescription": "حب 28/1050 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702510000000C~20260326170251.0000000\"",
            "Product": "15/28/50/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702510000000C~20260326170251.0000000\"",
                    "Product": "15/28/50/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1050 / 28 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702510000000C~20260326170251.0000000\"",
                    "Product": "15/28/50/6",
                    "Language": "EN",
                    "ProductDescription": "حب 28/1050 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702510000000C~20260326170251.0000000\"",
            "Product": "15/28/80/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702510000000C~20260326170251.0000000\"",
                    "Product": "15/28/80/555",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080 / 28 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702510000000C~20260326170251.0000000\"",
                    "Product": "15/28/80/555",
                    "Language": "EN",
                    "ProductDescription": "حب 28/1080 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624130000000C~20260327162413.0000000\"",
            "Product": "15/28/80/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624130000000C~20260327162413.0000000\"",
                    "Product": "15/28/80/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080 / 28 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624130000000C~20260327162413.0000000\"",
                    "Product": "15/28/80/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1080 / 28 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702510000000C~20260326170251.0000000\"",
            "Product": "15/28/82/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702510000000C~20260326170251.0000000\"",
                    "Product": "15/28/82/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1082/28 MM ( ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702510000000C~20260326170251.0000000\"",
                    "Product": "15/28/82/6",
                    "Language": "EN",
                    "ProductDescription": "حب 28 /1082  درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624120000000C~20260327162412.0000000\"",
            "Product": "15/28/84/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624120000000C~20260327162412.0000000\"",
                    "Product": "15/28/84/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1084 / 28 MM ( ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624120000000C~20260327162412.0000000\"",
                    "Product": "15/28/84/6",
                    "Language": "EN",
                    "ProductDescription": "حب 28 /1084درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702500000000C~20260326170250.0000000\"",
            "Product": "15/30/1006/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702500000000C~20260326170250.0000000\"",
                    "Product": "15/30/1006/6",
                    "Language": "AR",
                    "ProductDescription": "ROSETTE 1006/30 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702500000000C~20260326170250.0000000\"",
                    "Product": "15/30/1006/6",
                    "Language": "EN",
                    "ProductDescription": "وردة 30 /1006 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624120000000C~20260327162412.0000000\"",
            "Product": "15/30/1020/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624120000000C~20260327162412.0000000\"",
                    "Product": "15/30/1020/555",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1020 / 30 mm rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624120000000C~20260327162412.0000000\"",
                    "Product": "15/30/1020/555",
                    "Language": "EN",
                    "ProductDescription": "حب 30/1020 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702500000000C~20260326170250.0000000\"",
            "Product": "15/30/1020/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702500000000C~20260326170250.0000000\"",
                    "Product": "15/30/1020/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1020 / 30 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702500000000C~20260326170250.0000000\"",
                    "Product": "15/30/1020/6",
                    "Language": "EN",
                    "ProductDescription": "حب 30/1020 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702500000000C~20260326170250.0000000\"",
            "Product": "15/30/32/22",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702500000000C~20260326170250.0000000\"",
                    "Product": "15/30/32/22",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1032 / 30 MM 2ND."
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702500000000C~20260326170250.0000000\"",
                    "Product": "15/30/32/22",
                    "Language": "EN",
                    "ProductDescription": "حب 1032/30 مم ثاني"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702500000000C~20260326170250.0000000\"",
            "Product": "15/30/80/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702500000000C~20260326170250.0000000\"",
                    "Product": "15/30/80/555",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080 / 30 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702500000000C~20260326170250.0000000\"",
                    "Product": "15/30/80/555",
                    "Language": "EN",
                    "ProductDescription": "حب 30/1080 مم  RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624120000000C~20260327162412.0000000\"",
            "Product": "15/30/80/60",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624120000000C~20260327162412.0000000\"",
                    "Product": "15/30/80/60",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080/30 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624120000000C~20260327162412.0000000\"",
                    "Product": "15/30/80/60",
                    "Language": "EN",
                    "ProductDescription": "حب 1080 / 30 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702490000000C~20260326170249.0000000\"",
            "Product": "15/30/82/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702490000000C~20260326170249.0000000\"",
                    "Product": "15/30/82/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1082/30 MM ( ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702490000000C~20260326170249.0000000\"",
                    "Product": "15/30/82/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1082/30 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624110000000C~20260327162411.0000000\"",
            "Product": "15/32/1020/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624110000000C~20260327162411.0000000\"",
                    "Product": "15/32/1020/555",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1020 / 32 mm rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624110000000C~20260327162411.0000000\"",
                    "Product": "15/32/1020/555",
                    "Language": "EN",
                    "ProductDescription": "حب 32/1020 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702490000000C~20260326170249.0000000\"",
            "Product": "15/32/1020/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702490000000C~20260326170249.0000000\"",
                    "Product": "15/32/1020/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1020 / 32 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702490000000C~20260326170249.0000000\"",
                    "Product": "15/32/1020/6",
                    "Language": "EN",
                    "ProductDescription": "حب 32/1020 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624110000000C~20260327162411.0000000\"",
            "Product": "15/32/80/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624110000000C~20260327162411.0000000\"",
                    "Product": "15/32/80/333",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON  1080 / 32 mm L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624110000000C~20260327162411.0000000\"",
                    "Product": "15/32/80/333",
                    "Language": "EN",
                    "ProductDescription": "حب1080/32   L.COLLECTION"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702480000000C~20260326170248.0000000\"",
            "Product": "15/32/80/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702480000000C~20260326170248.0000000\"",
                    "Product": "15/32/80/555",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080 / 32 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702480000000C~20260326170248.0000000\"",
                    "Product": "15/32/80/555",
                    "Language": "EN",
                    "ProductDescription": "حب 32 / 1080 مم  RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624110000000C~20260327162411.0000000\"",
            "Product": "15/32/80/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624110000000C~20260327162411.0000000\"",
                    "Product": "15/32/80/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080/32 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624110000000C~20260327162411.0000000\"",
                    "Product": "15/32/80/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1080 /32مم (درجة موحدة )"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624110000000C~20260327162411.0000000\"",
            "Product": "15/34/1020/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624110000000C~20260327162411.0000000\"",
                    "Product": "15/34/1020/555",
                    "Language": "AR",
                    "ProductDescription": "حب 34/1020 درجة RAIN"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624110000000C~20260327162411.0000000\"",
                    "Product": "15/34/1020/555",
                    "Language": "EN",
                    "ProductDescription": "حب 34/1020 درجة RAIN"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624100000000C~20260327162410.0000000\"",
            "Product": "15/34/80/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624100000000C~20260327162410.0000000\"",
                    "Product": "15/34/80/333",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1080 / 34 MM L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624100000000C~20260327162410.0000000\"",
                    "Product": "15/34/80/333",
                    "Language": "EN",
                    "ProductDescription": "حب 34/1080 مم درجة L.COLLECTION"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624100000000C~20260327162410.0000000\"",
            "Product": "15/34/80/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624100000000C~20260327162410.0000000\"",
                    "Product": "15/34/80/555",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080 / 34 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624100000000C~20260327162410.0000000\"",
                    "Product": "15/34/80/555",
                    "Language": "EN",
                    "ProductDescription": "حب 34/1080 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702470000000C~20260326170247.0000000\"",
            "Product": "15/34/80/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702470000000C~20260326170247.0000000\"",
                    "Product": "15/34/80/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080/34 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702470000000C~20260326170247.0000000\"",
                    "Product": "15/34/80/6",
                    "Language": "EN",
                    "ProductDescription": "حب 34/1080 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702460000000C~20260326170246.0000000\"",
            "Product": "15/36/80/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702460000000C~20260326170246.0000000\"",
                    "Product": "15/36/80/555",
                    "Language": "AR",
                    "ProductDescription": "حب 36/1080 درجه RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702460000000C~20260326170246.0000000\"",
                    "Product": "15/36/80/555",
                    "Language": "EN",
                    "ProductDescription": "حب 36/1080 درجه RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702460000000C~20260326170246.0000000\"",
            "Product": "15/36/80/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702460000000C~20260326170246.0000000\"",
                    "Product": "15/36/80/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080 /36 (Almazza)"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702460000000C~20260326170246.0000000\"",
                    "Product": "15/36/80/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1080 /36مم (درجة موحدة )"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624090000000C~20260327162409.0000000\"",
            "Product": "15/38/1020/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624090000000C~20260327162409.0000000\"",
                    "Product": "15/38/1020/555",
                    "Language": "AR",
                    "ProductDescription": "حب 38/1020 درجة RAIN"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624090000000C~20260327162409.0000000\"",
                    "Product": "15/38/1020/555",
                    "Language": "EN",
                    "ProductDescription": "حب 38/1020 درجة RAIN"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702460000000C~20260326170246.0000000\"",
            "Product": "15/38/80/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702460000000C~20260326170246.0000000\"",
                    "Product": "15/38/80/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1080 / 38 MM ( ALMAZZA"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702460000000C~20260326170246.0000000\"",
                    "Product": "15/38/80/6",
                    "Language": "EN",
                    "ProductDescription": "حب 38/1080 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702450000000C~20260326170245.0000000\"",
            "Product": "15/40/1020/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702450000000C~20260326170245.0000000\"",
                    "Product": "15/40/1020/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1020 / 40 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702450000000C~20260326170245.0000000\"",
                    "Product": "15/40/1020/6",
                    "Language": "EN",
                    "ProductDescription": "حب 40/1020 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702450000000C~20260326170245.0000000\"",
            "Product": "15/40/31/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702450000000C~20260326170245.0000000\"",
                    "Product": "15/40/31/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1031/40 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702450000000C~20260326170245.0000000\"",
                    "Product": "15/40/31/6",
                    "Language": "EN",
                    "ProductDescription": "حب 40/1031 موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702450000000C~20260326170245.0000000\"",
            "Product": "15/40/32/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702450000000C~20260326170245.0000000\"",
                    "Product": "15/40/32/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1032/40 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702450000000C~20260326170245.0000000\"",
                    "Product": "15/40/32/6",
                    "Language": "EN",
                    "ProductDescription": "حب 40/1032 موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702440000000C~20260326170244.0000000\"",
            "Product": "15/40/40/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702440000000C~20260326170244.0000000\"",
                    "Product": "15/40/40/6",
                    "Language": "AR",
                    "ProductDescription": "Round 1040/40 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702440000000C~20260326170244.0000000\"",
                    "Product": "15/40/40/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1040 / 40 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624080000000C~20260327162408.0000000\"",
            "Product": "15/40/41/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624080000000C~20260327162408.0000000\"",
                    "Product": "15/40/41/333",
                    "Language": "AR",
                    "ProductDescription": "Round 1041/40 mm L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624080000000C~20260327162408.0000000\"",
                    "Product": "15/40/41/333",
                    "Language": "EN",
                    "ProductDescription": "حب 1041/40 L.COLLECTION"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624080000000C~20260327162408.0000000\"",
            "Product": "15/40/41/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624080000000C~20260327162408.0000000\"",
                    "Product": "15/40/41/555",
                    "Language": "AR",
                    "ProductDescription": "Round 1041/40 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624080000000C~20260327162408.0000000\"",
                    "Product": "15/40/41/555",
                    "Language": "EN",
                    "ProductDescription": "حب 40/1041مم  RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702440000000C~20260326170244.0000000\"",
            "Product": "15/40/41/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702440000000C~20260326170244.0000000\"",
                    "Product": "15/40/41/6",
                    "Language": "AR",
                    "ProductDescription": "Round 1041/40 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702440000000C~20260326170244.0000000\"",
                    "Product": "15/40/41/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1041 / 40 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624070000000C~20260327162407.0000000\"",
            "Product": "15/40/80/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624070000000C~20260327162407.0000000\"",
                    "Product": "15/40/80/333",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080/40  L.collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624070000000C~20260327162407.0000000\"",
                    "Product": "15/40/80/333",
                    "Language": "EN",
                    "ProductDescription": "حب 40/1080 مم درجة L.COLLECTION"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702430000000C~20260326170243.0000000\"",
            "Product": "15/40/80/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702430000000C~20260326170243.0000000\"",
                    "Product": "15/40/80/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1080 / 40 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702430000000C~20260326170243.0000000\"",
                    "Product": "15/40/80/6",
                    "Language": "EN",
                    "ProductDescription": "حب 40/1080 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624070000000C~20260327162407.0000000\"",
            "Product": "15/401/15/1",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624070000000C~20260327162407.0000000\"",
                    "Product": "15/401/15/1",
                    "Language": "AR",
                    "ProductDescription": "DROP 401/1.5''  (38mm)  1st"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624070000000C~20260327162407.0000000\"",
                    "Product": "15/401/15/1",
                    "Language": "EN",
                    "ProductDescription": "دبوس 1.5/401 اول"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702430000000C~20260326170243.0000000\"",
            "Product": "15/401/15/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702430000000C~20260326170243.0000000\"",
                    "Product": "15/401/15/555",
                    "Language": "AR",
                    "ProductDescription": "DROP 401 / 1.5 Inch Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702430000000C~20260326170243.0000000\"",
                    "Product": "15/401/15/555",
                    "Language": "EN",
                    "ProductDescription": "دبوس 1.5 /401 Rainbow"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702420000000C~20260326170242.0000000\"",
            "Product": "15/401/15/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702420000000C~20260326170242.0000000\"",
                    "Product": "15/401/15/6",
                    "Language": "AR",
                    "ProductDescription": "Drop 401/1.5 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702420000000C~20260326170242.0000000\"",
                    "Product": "15/401/15/6",
                    "Language": "EN",
                    "ProductDescription": "دبوس 401 / 1.5 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702420000000C~20260326170242.0000000\"",
            "Product": "15/401/20/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702420000000C~20260326170242.0000000\"",
                    "Product": "15/401/20/5554",
                    "Language": "AR",
                    "ProductDescription": "DROP 401/2 Inch Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702420000000C~20260326170242.0000000\"",
                    "Product": "15/401/20/5554",
                    "Language": "EN",
                    "ProductDescription": "دبوس 2/401 درجة RAINBOW  بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702420000000C~20260326170242.0000000\"",
            "Product": "15/401/20/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702420000000C~20260326170242.0000000\"",
                    "Product": "15/401/20/64",
                    "Language": "AR",
                    "ProductDescription": "Drop 401/2 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702420000000C~20260326170242.0000000\"",
                    "Product": "15/401/20/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس 401/2 درجه موحدة بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702420000000C~20260326170242.0000000\"",
            "Product": "15/401/25/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702420000000C~20260326170242.0000000\"",
                    "Product": "15/401/25/5554",
                    "Language": "AR",
                    "ProductDescription": "DROP 401/2.5 Inch Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702420000000C~20260326170242.0000000\"",
                    "Product": "15/401/25/5554",
                    "Language": "EN",
                    "ProductDescription": "دبوس 401/2.5بوصة باللوجوRAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624060000000C~20260327162406.0000000\"",
            "Product": "15/401/25/6664",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624060000000C~20260327162406.0000000\"",
                    "Product": "15/401/25/6664",
                    "Language": "AR",
                    "ProductDescription": "Drop 401/2.5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624060000000C~20260327162406.0000000\"",
                    "Product": "15/401/25/6664",
                    "Language": "EN",
                    "ProductDescription": "دبوس 401/2.5 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702410000000C~20260326170241.0000000\"",
            "Product": "15/401/30/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702410000000C~20260326170241.0000000\"",
                    "Product": "15/401/30/5554",
                    "Language": "AR",
                    "ProductDescription": "DROP 401/3 Inch Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702410000000C~20260326170241.0000000\"",
                    "Product": "15/401/30/5554",
                    "Language": "EN",
                    "ProductDescription": "دبوس 401/3 بوصة باللوجو RAinBow"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624060000000C~20260327162406.0000000\"",
            "Product": "15/401/30/6664",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624060000000C~20260327162406.0000000\"",
                    "Product": "15/401/30/6664",
                    "Language": "AR",
                    "ProductDescription": "Drop 401/3 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624060000000C~20260327162406.0000000\"",
                    "Product": "15/401/30/6664",
                    "Language": "EN",
                    "ProductDescription": "دبوس 401/3 بوصه درجه موحده باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702400000000C~20260326170240.0000000\"",
            "Product": "15/403/35/55",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702400000000C~20260326170240.0000000\"",
                    "Product": "15/403/35/55",
                    "Language": "AR",
                    "ProductDescription": "دبوس بطحة 403/3.5 درجة RAINBOW قلاوظ"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702400000000C~20260326170240.0000000\"",
                    "Product": "15/403/35/55",
                    "Language": "EN",
                    "ProductDescription": "دبوس بطحة 403/3.5 درجة RAINBOW قلاوظ"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702400000000C~20260326170240.0000000\"",
            "Product": "15/403/35/66",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702400000000C~20260326170240.0000000\"",
                    "Product": "15/403/35/66",
                    "Language": "AR",
                    "ProductDescription": "Drop 403/3.5 Inch Almazza With Pin"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702400000000C~20260326170240.0000000\"",
                    "Product": "15/403/35/66",
                    "Language": "EN",
                    "ProductDescription": "دبوس بطحة 403/3.5 درجة موحدة قلاوظ"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624060000000C~20260327162406.0000000\"",
            "Product": "15/405/20/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624060000000C~20260327162406.0000000\"",
                    "Product": "15/405/20/333",
                    "Language": "AR",
                    "ProductDescription": "DROP 405 / 20 mm L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624060000000C~20260327162406.0000000\"",
                    "Product": "15/405/20/333",
                    "Language": "EN",
                    "ProductDescription": "دبوس 405 / 20 مم L.Collection"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624050000000C~20260327162405.0000000\"",
            "Product": "15/405/20/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624050000000C~20260327162405.0000000\"",
                    "Product": "15/405/20/555",
                    "Language": "AR",
                    "ProductDescription": "دبوس 20/405 درجه RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624050000000C~20260327162405.0000000\"",
                    "Product": "15/405/20/555",
                    "Language": "EN",
                    "ProductDescription": "دبوس 20/405 درجه RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702390000000C~20260326170239.0000000\"",
            "Product": "15/405/20/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702390000000C~20260326170239.0000000\"",
                    "Product": "15/405/20/6",
                    "Language": "AR",
                    "ProductDescription": "Drop 405 / 20 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702390000000C~20260326170239.0000000\"",
                    "Product": "15/405/20/6",
                    "Language": "EN",
                    "ProductDescription": "دبوس 405 / 20 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624040000000C~20260327162404.0000000\"",
            "Product": "15/424/20/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624040000000C~20260327162404.0000000\"",
                    "Product": "15/424/20/333",
                    "Language": "AR",
                    "ProductDescription": "DROP 424/20 mm L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624040000000C~20260327162404.0000000\"",
                    "Product": "15/424/20/333",
                    "Language": "EN",
                    "ProductDescription": "دبوس 424/20 مم L.collection"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702380000000C~20260326170238.0000000\"",
            "Product": "15/424/20/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702380000000C~20260326170238.0000000\"",
                    "Product": "15/424/20/6",
                    "Language": "AR",
                    "ProductDescription": "DROP 424/20 MM ( ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702380000000C~20260326170238.0000000\"",
                    "Product": "15/424/20/6",
                    "Language": "EN",
                    "ProductDescription": "دبوس 424/20 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702380000000C~20260326170238.0000000\"",
            "Product": "15/424/20/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702380000000C~20260326170238.0000000\"",
                    "Product": "15/424/20/64",
                    "Language": "AR",
                    "ProductDescription": "DROP 424/2 INCH ( ALMAZZA ) L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702380000000C~20260326170238.0000000\"",
                    "Product": "15/424/20/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس 424/2 درجه موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624040000000C~20260327162404.0000000\"",
            "Product": "15/424/25/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624040000000C~20260327162404.0000000\"",
                    "Product": "15/424/25/5554",
                    "Language": "AR",
                    "ProductDescription": "DROP 424/2.5 RAINBOW L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624040000000C~20260327162404.0000000\"",
                    "Product": "15/424/25/5554",
                    "Language": "EN",
                    "ProductDescription": "دبوس 424/2.5 بوصةRAINBOW باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624040000000C~20260327162404.0000000\"",
            "Product": "15/424/25/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624040000000C~20260327162404.0000000\"",
                    "Product": "15/424/25/64",
                    "Language": "AR",
                    "ProductDescription": "Drop 424/2.5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624040000000C~20260327162404.0000000\"",
                    "Product": "15/424/25/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس 424/2.5 بوصة درجة موحدة  باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624030000000C~20260327162403.0000000\"",
            "Product": "15/424/30/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624030000000C~20260327162403.0000000\"",
                    "Product": "15/424/30/5554",
                    "Language": "AR",
                    "ProductDescription": "DROP 3/424  INCH  RAinBow  L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624030000000C~20260327162403.0000000\"",
                    "Product": "15/424/30/5554",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/424 بوصة RAIN باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702370000000C~20260326170237.0000000\"",
            "Product": "15/424/30/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702370000000C~20260326170237.0000000\"",
                    "Product": "15/424/30/64",
                    "Language": "AR",
                    "ProductDescription": "DROP 424/3 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702370000000C~20260326170237.0000000\"",
                    "Product": "15/424/30/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس 424/3 بوصة درجة موحدة  باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624030000000C~20260327162403.0000000\"",
            "Product": "15/424/30/6664",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624030000000C~20260327162403.0000000\"",
                    "Product": "15/424/30/6664",
                    "Language": "AR",
                    "ProductDescription": "DROP 424/3 INCH ( ALMAZZA ) L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624030000000C~20260327162403.0000000\"",
                    "Product": "15/424/30/6664",
                    "Language": "EN",
                    "ProductDescription": "دبوس 424/3 بوصه درجه موحده باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624030000000C~20260327162403.0000000\"",
            "Product": "15/428/25/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624030000000C~20260327162403.0000000\"",
                    "Product": "15/428/25/64",
                    "Language": "AR",
                    "ProductDescription": "Drop 428/2.5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624030000000C~20260327162403.0000000\"",
                    "Product": "15/428/25/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس 2.5 / 428 درجه موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624030000000C~20260327162403.0000000\"",
            "Product": "15/428/30/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624030000000C~20260327162403.0000000\"",
                    "Product": "15/428/30/64",
                    "Language": "AR",
                    "ProductDescription": "Drop 428/3 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624030000000C~20260327162403.0000000\"",
                    "Product": "15/428/30/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3 / 428 درجه موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624030000000C~20260327162403.0000000\"",
            "Product": "15/432/15/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624030000000C~20260327162403.0000000\"",
                    "Product": "15/432/15/333",
                    "Language": "AR",
                    "ProductDescription": "DROP 432 / 1.5 mm L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624030000000C~20260327162403.0000000\"",
                    "Product": "15/432/15/333",
                    "Language": "EN",
                    "ProductDescription": "دبوس 432 / 1.5 بوصة L.Collection"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702360000000C~20260326170236.0000000\"",
            "Product": "15/432/15/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702360000000C~20260326170236.0000000\"",
                    "Product": "15/432/15/555",
                    "Language": "AR",
                    "ProductDescription": "Drop 432 / 1.5 Inch Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702360000000C~20260326170236.0000000\"",
                    "Product": "15/432/15/555",
                    "Language": "EN",
                    "ProductDescription": "دبوس 432 / 1.5 بوصة درجة Rainbow"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702350000000C~20260326170235.0000000\"",
            "Product": "15/432/15/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702350000000C~20260326170235.0000000\"",
                    "Product": "15/432/15/6",
                    "Language": "AR",
                    "ProductDescription": "Drop 432/1.5 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702350000000C~20260326170235.0000000\"",
                    "Product": "15/432/15/6",
                    "Language": "EN",
                    "ProductDescription": "دبوس 432 / 1.5 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624020000000C~20260327162402.0000000\"",
            "Product": "15/432/20/54",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624020000000C~20260327162402.0000000\"",
                    "Product": "15/432/20/54",
                    "Language": "AR",
                    "ProductDescription": "دبوس 432/2 بوصة درجه RAINBOW باللوجو"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624020000000C~20260327162402.0000000\"",
                    "Product": "15/432/20/54",
                    "Language": "EN",
                    "ProductDescription": "دبوس 432/2 بوصة درجه RAINBOW باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702350000000C~20260326170235.0000000\"",
            "Product": "15/432/20/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702350000000C~20260326170235.0000000\"",
                    "Product": "15/432/20/555",
                    "Language": "AR",
                    "ProductDescription": "DROP 432 / 20 MM RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702350000000C~20260326170235.0000000\"",
                    "Product": "15/432/20/555",
                    "Language": "EN",
                    "ProductDescription": "دبوس 20/432 مم درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624020000000C~20260327162402.0000000\"",
            "Product": "15/432/20/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624020000000C~20260327162402.0000000\"",
                    "Product": "15/432/20/6",
                    "Language": "AR",
                    "ProductDescription": "Drop 432 / 20 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624020000000C~20260327162402.0000000\"",
                    "Product": "15/432/20/6",
                    "Language": "EN",
                    "ProductDescription": "دبوس 432 / 20 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702340000000C~20260326170234.0000000\"",
            "Product": "15/432/20/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702340000000C~20260326170234.0000000\"",
                    "Product": "15/432/20/64",
                    "Language": "AR",
                    "ProductDescription": "Drop 432/2 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702340000000C~20260326170234.0000000\"",
                    "Product": "15/432/20/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس 432/2 بوصة درجه موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702340000000C~20260326170234.0000000\"",
            "Product": "15/432/25/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702340000000C~20260326170234.0000000\"",
                    "Product": "15/432/25/5554",
                    "Language": "AR",
                    "ProductDescription": "DROP 432/2.5 Inch Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702340000000C~20260326170234.0000000\"",
                    "Product": "15/432/25/5554",
                    "Language": "EN",
                    "ProductDescription": "دبوس 432/2.5 بوصة درجة RAINBOW باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624020000000C~20260327162402.0000000\"",
            "Product": "15/432/25/6664",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624020000000C~20260327162402.0000000\"",
                    "Product": "15/432/25/6664",
                    "Language": "AR",
                    "ProductDescription": "Drop 432/2.5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624020000000C~20260327162402.0000000\"",
                    "Product": "15/432/25/6664",
                    "Language": "EN",
                    "ProductDescription": "دبوس 2.5/432 درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624010000000C~20260327162401.0000000\"",
            "Product": "15/432/30/534",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624010000000C~20260327162401.0000000\"",
                    "Product": "15/432/30/534",
                    "Language": "AR",
                    "ProductDescription": "Drop 432/3 Inch Rainbow Plus"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624010000000C~20260327162401.0000000\"",
                    "Product": "15/432/30/534",
                    "Language": "EN",
                    "ProductDescription": "دبوس 432/3 باللوجو RAIN بلاس"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624010000000C~20260327162401.0000000\"",
            "Product": "15/432/30/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624010000000C~20260327162401.0000000\"",
                    "Product": "15/432/30/5554",
                    "Language": "AR",
                    "ProductDescription": "DROP 432 / 30 INCH Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624010000000C~20260327162401.0000000\"",
                    "Product": "15/432/30/5554",
                    "Language": "EN",
                    "ProductDescription": "دبوس 432/3 بوصة درجة RAINBOW باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702330000000C~20260326170233.0000000\"",
            "Product": "15/432/30/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702330000000C~20260326170233.0000000\"",
                    "Product": "15/432/30/64",
                    "Language": "AR",
                    "ProductDescription": "Drop 432/3 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702330000000C~20260326170233.0000000\"",
                    "Product": "15/432/30/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس 432/3 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624010000000C~20260327162401.0000000\"",
            "Product": "15/45/40/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624010000000C~20260327162401.0000000\"",
                    "Product": "15/45/40/333",
                    "Language": "AR",
                    "ProductDescription": "Round 1040/45 mm L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624010000000C~20260327162401.0000000\"",
                    "Product": "15/45/40/333",
                    "Language": "EN",
                    "ProductDescription": "حب45/1040م L.COLLECTION"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702320000000C~20260326170232.0000000\"",
            "Product": "15/45/40/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702320000000C~20260326170232.0000000\"",
                    "Product": "15/45/40/6",
                    "Language": "AR",
                    "ProductDescription": "Round 1040/45 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702320000000C~20260326170232.0000000\"",
                    "Product": "15/45/40/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1040 / 45 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624010000000C~20260327162401.0000000\"",
            "Product": "15/45/41/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624010000000C~20260327162401.0000000\"",
                    "Product": "15/45/41/333",
                    "Language": "AR",
                    "ProductDescription": "Round 1041/45 mm L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624010000000C~20260327162401.0000000\"",
                    "Product": "15/45/41/333",
                    "Language": "EN",
                    "ProductDescription": "حب 1041 / 45 مم L.Collection"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702320000000C~20260326170232.0000000\"",
            "Product": "15/45/41/5",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702320000000C~20260326170232.0000000\"",
                    "Product": "15/45/41/5",
                    "Language": "AR",
                    "ProductDescription": "Round 1041/45 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702320000000C~20260326170232.0000000\"",
                    "Product": "15/45/41/5",
                    "Language": "EN",
                    "ProductDescription": "حب 45/1041 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702320000000C~20260326170232.0000000\"",
            "Product": "15/45/41/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702320000000C~20260326170232.0000000\"",
                    "Product": "15/45/41/6",
                    "Language": "AR",
                    "ProductDescription": "Round 1041/45 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702320000000C~20260326170232.0000000\"",
                    "Product": "15/45/41/6",
                    "Language": "EN",
                    "ProductDescription": "حب 1041 / 45 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702320000000C~20260326170232.0000000\"",
            "Product": "15/485/25/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702320000000C~20260326170232.0000000\"",
                    "Product": "15/485/25/5554",
                    "Language": "AR",
                    "ProductDescription": "DROP 485/2.5 Inch  RAINBOW L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702320000000C~20260326170232.0000000\"",
                    "Product": "15/485/25/5554",
                    "Language": "EN",
                    "ProductDescription": "دبوس 485/2.5 بوصة درجة RAINBOW باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702310000000C~20260326170231.0000000\"",
            "Product": "15/485/25/6664",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702310000000C~20260326170231.0000000\"",
                    "Product": "15/485/25/6664",
                    "Language": "AR",
                    "ProductDescription": "Drop 485/2.5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702310000000C~20260326170231.0000000\"",
                    "Product": "15/485/25/6664",
                    "Language": "EN",
                    "ProductDescription": "دبوس 485/2.5 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624000000000C~20260327162400.0000000\"",
            "Product": "15/485/30/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624000000000C~20260327162400.0000000\"",
                    "Product": "15/485/30/5554",
                    "Language": "AR",
                    "ProductDescription": "DROP 485/3 INCH ( RAINBOW ) L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624000000000C~20260327162400.0000000\"",
                    "Product": "15/485/30/5554",
                    "Language": "EN",
                    "ProductDescription": "دبوس3/485 درجة RAINBOW باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702310000000C~20260326170231.0000000\"",
            "Product": "15/485/30/6664",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702310000000C~20260326170231.0000000\"",
                    "Product": "15/485/30/6664",
                    "Language": "AR",
                    "ProductDescription": "Drop 485/3 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702310000000C~20260326170231.0000000\"",
                    "Product": "15/485/30/6664",
                    "Language": "EN",
                    "ProductDescription": "دبوس  485/ 3 بوصة درجة موحدة  باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624000000000C~20260327162400.0000000\"",
            "Product": "15/50/1020/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624000000000C~20260327162400.0000000\"",
                    "Product": "15/50/1020/555",
                    "Language": "AR",
                    "ProductDescription": "حب 50/1020 درجة RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624000000000C~20260327162400.0000000\"",
                    "Product": "15/50/1020/555",
                    "Language": "EN",
                    "ProductDescription": "حب 50/1020 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702300000000C~20260326170230.0000000\"",
            "Product": "15/50/1020/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702300000000C~20260326170230.0000000\"",
                    "Product": "15/50/1020/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1020 / 50 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702300000000C~20260326170230.0000000\"",
                    "Product": "15/50/1020/6",
                    "Language": "EN",
                    "ProductDescription": "حب 50/1020 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702290000000C~20260326170229.0000000\"",
            "Product": "15/50/31/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702290000000C~20260326170229.0000000\"",
                    "Product": "15/50/31/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1031/50 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702290000000C~20260326170229.0000000\"",
                    "Product": "15/50/31/6",
                    "Language": "EN",
                    "ProductDescription": "حب 50/1031 موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624000000000C~20260327162400.0000000\"",
            "Product": "15/50/32/5",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624000000000C~20260327162400.0000000\"",
                    "Product": "15/50/32/5",
                    "Language": "AR",
                    "ProductDescription": "حب 50/1032 درجة RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624000000000C~20260327162400.0000000\"",
                    "Product": "15/50/32/5",
                    "Language": "EN",
                    "ProductDescription": "حب 50/1032 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702290000000C~20260326170229.0000000\"",
            "Product": "15/50/32/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702290000000C~20260326170229.0000000\"",
                    "Product": "15/50/32/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1032/50 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702290000000C~20260326170229.0000000\"",
                    "Product": "15/50/32/6",
                    "Language": "EN",
                    "ProductDescription": "حب 50/1032 موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271624000000000C~20260327162400.0000000\"",
            "Product": "15/50/80/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271624000000000C~20260327162400.0000000\"",
                    "Product": "15/50/80/333",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080 / 50 mm L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271624000000000C~20260327162400.0000000\"",
                    "Product": "15/50/80/333",
                    "Language": "EN",
                    "ProductDescription": "حب 50/1080مم L.COLLECTION"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623590000000C~20260327162359.0000000\"",
            "Product": "15/50/80/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623590000000C~20260327162359.0000000\"",
                    "Product": "15/50/80/555",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1080/50 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623590000000C~20260327162359.0000000\"",
                    "Product": "15/50/80/555",
                    "Language": "EN",
                    "ProductDescription": "حب 50/1080 درجه RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702280000000C~20260326170228.0000000\"",
            "Product": "15/50/80/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702280000000C~20260326170228.0000000\"",
                    "Product": "15/50/80/6",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1080/50 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702280000000C~20260326170228.0000000\"",
                    "Product": "15/50/80/6",
                    "Language": "EN",
                    "ProductDescription": "حب 50 / 1080 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623590000000C~20260327162359.0000000\"",
            "Product": "15/500/100/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623590000000C~20260327162359.0000000\"",
                    "Product": "15/500/100/6",
                    "Language": "AR",
                    "ProductDescription": "Banana 100 mm. ALMAZZA"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623590000000C~20260327162359.0000000\"",
                    "Product": "15/500/100/6",
                    "Language": "EN",
                    "ProductDescription": "موزه 100/500 مم درجه موحده"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702280000000C~20260326170228.0000000\"",
            "Product": "15/502/35/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702280000000C~20260326170228.0000000\"",
                    "Product": "15/502/35/6",
                    "Language": "AR",
                    "ProductDescription": "Drop 502 / 3.5 Inch ALmazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702280000000C~20260326170228.0000000\"",
                    "Product": "15/502/35/6",
                    "Language": "EN",
                    "ProductDescription": "دبوس 502 / 3.5 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623590000000C~20260327162359.0000000\"",
            "Product": "15/504/25/3334",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623590000000C~20260327162359.0000000\"",
                    "Product": "15/504/25/3334",
                    "Language": "AR",
                    "ProductDescription": "DROP 2.5/504  Inch L.Collection L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623590000000C~20260327162359.0000000\"",
                    "Product": "15/504/25/3334",
                    "Language": "EN",
                    "ProductDescription": "دبوس 2.5/504 بوصة L.collection باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702270000000C~20260326170227.0000000\"",
            "Product": "15/504/25/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702270000000C~20260326170227.0000000\"",
                    "Product": "15/504/25/5554",
                    "Language": "AR",
                    "ProductDescription": "دبوس 2.5/504 درجة Rainbow بالوجو"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702270000000C~20260326170227.0000000\"",
                    "Product": "15/504/25/5554",
                    "Language": "EN",
                    "ProductDescription": "دبوس 2.5/504 درجة Rainbow بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623580000000C~20260327162358.0000000\"",
            "Product": "15/504/25/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623580000000C~20260327162358.0000000\"",
                    "Product": "15/504/25/64",
                    "Language": "AR",
                    "ProductDescription": "Drop 504/2.5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623580000000C~20260327162358.0000000\"",
                    "Product": "15/504/25/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس2.5/504 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623580000000C~20260327162358.0000000\"",
            "Product": "15/504/30/3334",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623580000000C~20260327162358.0000000\"",
                    "Product": "15/504/30/3334",
                    "Language": "AR",
                    "ProductDescription": "DROP 504/3 Inch L.Collection L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623580000000C~20260327162358.0000000\"",
                    "Product": "15/504/30/3334",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 بوصة درجة L. CO باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702270000000C~20260326170227.0000000\"",
            "Product": "15/504/30/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702270000000C~20260326170227.0000000\"",
                    "Product": "15/504/30/5554",
                    "Language": "AR",
                    "ProductDescription": "DROP 504/3 Inch Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702270000000C~20260326170227.0000000\"",
                    "Product": "15/504/30/5554",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702260000000C~20260326170226.0000000\"",
            "Product": "15/504/30/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702260000000C~20260326170226.0000000\"",
                    "Product": "15/504/30/6",
                    "Language": "AR",
                    "ProductDescription": "DROP 504 / 3 INCH ALMAZZA"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702260000000C~20260326170226.0000000\"",
                    "Product": "15/504/30/6",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702260000000C~20260326170226.0000000\"",
            "Product": "15/504/30/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702260000000C~20260326170226.0000000\"",
                    "Product": "15/504/30/64",
                    "Language": "AR",
                    "ProductDescription": "Drop 504/3 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702260000000C~20260326170226.0000000\"",
                    "Product": "15/504/30/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702260000000C~20260326170226.0000000\"",
            "Product": "15/504/63/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702260000000C~20260326170226.0000000\"",
                    "Product": "15/504/63/6",
                    "Language": "AR",
                    "ProductDescription": "DROP 504 / 2.5 INCH ( ALMAZZA ) ."
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702260000000C~20260326170226.0000000\"",
                    "Product": "15/504/63/6",
                    "Language": "EN",
                    "ProductDescription": "دبوس 504 / 2.5 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702250000000C~20260326170225.0000000\"",
            "Product": "15/505/25/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702250000000C~20260326170225.0000000\"",
                    "Product": "15/505/25/64",
                    "Language": "AR",
                    "ProductDescription": "DROP 505/2.5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702250000000C~20260326170225.0000000\"",
                    "Product": "15/505/25/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس  505/2.5 L بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702240000000C~20260326170224.0000000\"",
            "Product": "15/505/30/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702240000000C~20260326170224.0000000\"",
                    "Product": "15/505/30/64",
                    "Language": "AR",
                    "ProductDescription": "Drop 505/3 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702240000000C~20260326170224.0000000\"",
                    "Product": "15/505/30/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/505 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702240000000C~20260326170224.0000000\"",
            "Product": "15/505/40/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702240000000C~20260326170224.0000000\"",
                    "Product": "15/505/40/64",
                    "Language": "AR",
                    "ProductDescription": "Drop 505/4 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702240000000C~20260326170224.0000000\"",
                    "Product": "15/505/40/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس 4/505 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623570000000C~20260327162357.0000000\"",
            "Product": "15/505/50/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623570000000C~20260327162357.0000000\"",
                    "Product": "15/505/50/64",
                    "Language": "AR",
                    "ProductDescription": "Drop 505/5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623570000000C~20260327162357.0000000\"",
                    "Product": "15/505/50/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس 5/505    بوصه درجه موحده باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623570000000C~20260327162357.0000000\"",
            "Product": "15/505/60/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623570000000C~20260327162357.0000000\"",
                    "Product": "15/505/60/64",
                    "Language": "AR",
                    "ProductDescription": "Drop 505/6 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623570000000C~20260327162357.0000000\"",
                    "Product": "15/505/60/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس 6/505 بوصه درجه موحده باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623560000000C~20260327162356.0000000\"",
            "Product": "15/505/63/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623560000000C~20260327162356.0000000\"",
                    "Product": "15/505/63/6",
                    "Language": "AR",
                    "ProductDescription": "DROP 505 / 2.5 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623560000000C~20260327162356.0000000\"",
                    "Product": "15/505/63/6",
                    "Language": "EN",
                    "ProductDescription": "دبوس 505 / 2.5 بوصه درجه موحده"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623560000000C~20260327162356.0000000\"",
            "Product": "15/505/76/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623560000000C~20260327162356.0000000\"",
                    "Product": "15/505/76/6",
                    "Language": "AR",
                    "ProductDescription": "DROP 505 / 3 INCH (ALMAZZA )."
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623560000000C~20260327162356.0000000\"",
                    "Product": "15/505/76/6",
                    "Language": "EN",
                    "ProductDescription": "دبوس 505 / 3 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623560000000C~20260327162356.0000000\"",
            "Product": "15/508/730/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623560000000C~20260327162356.0000000\"",
                    "Product": "15/508/730/6",
                    "Language": "AR",
                    "ProductDescription": "Drop 508/3 Inch Ball 30 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623560000000C~20260327162356.0000000\"",
                    "Product": "15/508/730/6",
                    "Language": "EN",
                    "ProductDescription": "دبوس 508/3 بالكرة 30 مل موحد"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623560000000C~20260327162356.0000000\"",
            "Product": "15/508/740/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623560000000C~20260327162356.0000000\"",
                    "Product": "15/508/740/6",
                    "Language": "AR",
                    "ProductDescription": "Drop 508/4 Inch Ball 40 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623560000000C~20260327162356.0000000\"",
                    "Product": "15/508/740/6",
                    "Language": "EN",
                    "ProductDescription": "دبوس 508/4 بالكرة 40 مل موحد"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702220000000C~20260326170222.0000000\"",
            "Product": "15/516/35/5",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702220000000C~20260326170222.0000000\"",
                    "Product": "15/516/35/5",
                    "Language": "AR",
                    "ProductDescription": "DROP 516 /3.5 Inch Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702220000000C~20260326170222.0000000\"",
                    "Product": "15/516/35/5",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3.5/516 درجه RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702220000000C~20260326170222.0000000\"",
            "Product": "15/516/35/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702220000000C~20260326170222.0000000\"",
                    "Product": "15/516/35/6",
                    "Language": "AR",
                    "ProductDescription": "DROP 516 /3.5 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702220000000C~20260326170222.0000000\"",
                    "Product": "15/516/35/6",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3.5/516 درجه موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623550000000C~20260327162355.0000000\"",
            "Product": "15/6/52/5",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623550000000C~20260327162355.0000000\"",
                    "Product": "15/6/52/5",
                    "Language": "AR",
                    "ProductDescription": "سبحة6/1502 درجة RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623550000000C~20260327162355.0000000\"",
                    "Product": "15/6/52/5",
                    "Language": "EN",
                    "ProductDescription": "سبحة6/1502 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702210000000C~20260326170221.0000000\"",
            "Product": "15/6/52/65",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702210000000C~20260326170221.0000000\"",
                    "Product": "15/6/52/65",
                    "Language": "AR",
                    "ProductDescription": "Bead 1502/6 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702210000000C~20260326170221.0000000\"",
                    "Product": "15/6/52/65",
                    "Language": "EN",
                    "ProductDescription": "سبحة6م/1502 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702200000000C~20260326170220.0000000\"",
            "Product": "15/60/31/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702200000000C~20260326170220.0000000\"",
                    "Product": "15/60/31/6",
                    "Language": "AR",
                    "ProductDescription": "Octagon 1031/60 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702200000000C~20260326170220.0000000\"",
                    "Product": "15/60/31/6",
                    "Language": "EN",
                    "ProductDescription": "حب 60/1031 موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702200000000C~20260326170220.0000000\"",
            "Product": "15/60/80/66",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702200000000C~20260326170220.0000000\"",
                    "Product": "15/60/80/66",
                    "Language": "AR",
                    "ProductDescription": "OCTAGON 1080 / 60 MM (ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702200000000C~20260326170220.0000000\"",
                    "Product": "15/60/80/66",
                    "Language": "EN",
                    "ProductDescription": "حب 60/1080 موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623540000000C~20260327162354.0000000\"",
            "Product": "15/601/40/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623540000000C~20260327162354.0000000\"",
                    "Product": "15/601/40/64",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 601/ 4 INCH (ALMAZZA ) L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623540000000C~20260327162354.0000000\"",
                    "Product": "15/601/40/64",
                    "Language": "EN",
                    "ProductDescription": "عقله 601/4 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623530000000C~20260327162353.0000000\"",
            "Product": "15/604/20/33334",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623530000000C~20260327162353.0000000\"",
                    "Product": "15/604/20/33334",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 604/2 Inch L.Collection L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623530000000C~20260327162353.0000000\"",
                    "Product": "15/604/20/33334",
                    "Language": "EN",
                    "ProductDescription": "عقلة 604/2 بوصة درجة L.CO باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702190000000C~20260326170219.0000000\"",
            "Product": "15/604/20/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702190000000C~20260326170219.0000000\"",
                    "Product": "15/604/20/5554",
                    "Language": "AR",
                    "ProductDescription": "عقلة 2 /604 درجة RAINBOW  بالوجو"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702190000000C~20260326170219.0000000\"",
                    "Product": "15/604/20/5554",
                    "Language": "EN",
                    "ProductDescription": "عقلة 2 /604 درجة RAINBOW  بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623530000000C~20260327162353.0000000\"",
            "Product": "15/604/20/664",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623530000000C~20260327162353.0000000\"",
                    "Product": "15/604/20/664",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 604/2 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623530000000C~20260327162353.0000000\"",
                    "Product": "15/604/20/664",
                    "Language": "EN",
                    "ProductDescription": "عقلة   604/2 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702180000000C~20260326170218.0000000\"",
            "Product": "15/604/25/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702180000000C~20260326170218.0000000\"",
                    "Product": "15/604/25/5554",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 604 / 2.5 Inch Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702180000000C~20260326170218.0000000\"",
                    "Product": "15/604/25/5554",
                    "Language": "EN",
                    "ProductDescription": "عقلة 2.5 /604 درجة RAINBOW  بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702180000000C~20260326170218.0000000\"",
            "Product": "15/604/30/54",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702180000000C~20260326170218.0000000\"",
                    "Product": "15/604/30/54",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 604/3 Inch Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702180000000C~20260326170218.0000000\"",
                    "Product": "15/604/30/54",
                    "Language": "EN",
                    "ProductDescription": "عقلة 604/3درجة RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702180000000C~20260326170218.0000000\"",
            "Product": "15/604/30/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702180000000C~20260326170218.0000000\"",
                    "Product": "15/604/30/6",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 604/3 INCH (ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702180000000C~20260326170218.0000000\"",
                    "Product": "15/604/30/6",
                    "Language": "EN",
                    "ProductDescription": "عقلة 3/604 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623530000000C~20260327162353.0000000\"",
            "Product": "15/604/30/664",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623530000000C~20260327162353.0000000\"",
                    "Product": "15/604/30/664",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 604/3 Inch Almaza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623530000000C~20260327162353.0000000\"",
                    "Product": "15/604/30/664",
                    "Language": "EN",
                    "ProductDescription": "عقلة 604/3 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702170000000C~20260326170217.0000000\"",
            "Product": "15/604/35/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702170000000C~20260326170217.0000000\"",
                    "Product": "15/604/35/6",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 604/3.5 INCH (ALMAZZA("
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702170000000C~20260326170217.0000000\"",
                    "Product": "15/604/35/6",
                    "Language": "EN",
                    "ProductDescription": "عقلة 3.5/604 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623520000000C~20260327162352.0000000\"",
            "Product": "15/604/40/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623520000000C~20260327162352.0000000\"",
                    "Product": "15/604/40/6",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 604/4 INCH (ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623520000000C~20260327162352.0000000\"",
                    "Product": "15/604/40/6",
                    "Language": "EN",
                    "ProductDescription": "عقلة 4/604 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623520000000C~20260327162352.0000000\"",
            "Product": "15/604/51/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623520000000C~20260327162352.0000000\"",
                    "Product": "15/604/51/6",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 604 / 2 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623520000000C~20260327162352.0000000\"",
                    "Product": "15/604/51/6",
                    "Language": "EN",
                    "ProductDescription": "عقلة 604 / 2 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623520000000C~20260327162352.0000000\"",
            "Product": "15/604/58/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623520000000C~20260327162352.0000000\"",
                    "Product": "15/604/58/5554",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 604/2.25 Inch Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623520000000C~20260327162352.0000000\"",
                    "Product": "15/604/58/5554",
                    "Language": "EN",
                    "ProductDescription": "عقلة 2.25 /604 درجة RAINBOW  بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702160000000C~20260326170216.0000000\"",
            "Product": "15/604/58/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702160000000C~20260326170216.0000000\"",
                    "Product": "15/604/58/6",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 604/2.25 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702160000000C~20260326170216.0000000\"",
                    "Product": "15/604/58/6",
                    "Language": "EN",
                    "ProductDescription": "عقلة 604 / 2.25 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623520000000C~20260327162352.0000000\"",
            "Product": "15/604/58/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623520000000C~20260327162352.0000000\"",
                    "Product": "15/604/58/64",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 604/2.25 Inch ALmazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623520000000C~20260327162352.0000000\"",
                    "Product": "15/604/58/64",
                    "Language": "EN",
                    "ProductDescription": "عقلة 604 /2.25 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702160000000C~20260326170216.0000000\"",
            "Product": "15/604/60/664",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702160000000C~20260326170216.0000000\"",
                    "Product": "15/604/60/664",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 604/6 Inch Almaza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702160000000C~20260326170216.0000000\"",
                    "Product": "15/604/60/664",
                    "Language": "EN",
                    "ProductDescription": "عقلة 604/6 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702160000000C~20260326170216.0000000\"",
            "Product": "15/604/60/6664",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702160000000C~20260326170216.0000000\"",
                    "Product": "15/604/60/6664",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 604/6 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702160000000C~20260326170216.0000000\"",
                    "Product": "15/604/60/6664",
                    "Language": "EN",
                    "ProductDescription": "عقلة 604/6 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623510000000C~20260327162351.0000000\"",
            "Product": "15/604/63/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623510000000C~20260327162351.0000000\"",
                    "Product": "15/604/63/6",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 604 / 2.5 INCH ALMAZZA ."
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623510000000C~20260327162351.0000000\"",
                    "Product": "15/604/63/6",
                    "Language": "EN",
                    "ProductDescription": "عقله2.5/604 بوصه درجه موحده"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702150000000C~20260326170215.0000000\"",
            "Product": "15/604/63/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702150000000C~20260326170215.0000000\"",
                    "Product": "15/604/63/64",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 604/2.5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702150000000C~20260326170215.0000000\"",
                    "Product": "15/604/63/64",
                    "Language": "EN",
                    "ProductDescription": "عقله2.5/604 بوصه درجه موحده باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623510000000C~20260327162351.0000000\"",
            "Product": "15/605/20/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623510000000C~20260327162351.0000000\"",
                    "Product": "15/605/20/6",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 605/2 INCH ALMAZZA"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623510000000C~20260327162351.0000000\"",
                    "Product": "15/605/20/6",
                    "Language": "EN",
                    "ProductDescription": "عقله 2/605 بوصة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623510000000C~20260327162351.0000000\"",
            "Product": "15/605/30/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623510000000C~20260327162351.0000000\"",
                    "Product": "15/605/30/6",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 605/3 INCH ALMAZZA"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623510000000C~20260327162351.0000000\"",
                    "Product": "15/605/30/6",
                    "Language": "EN",
                    "ProductDescription": "عقله 3/605 بوصة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623510000000C~20260327162351.0000000\"",
            "Product": "15/605/51/21",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623510000000C~20260327162351.0000000\"",
                    "Product": "15/605/51/21",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 605 / 2 INCH 2ND."
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623510000000C~20260327162351.0000000\"",
                    "Product": "15/605/51/21",
                    "Language": "EN",
                    "ProductDescription": "عقلة 605 / 2 بوصة ثاني"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623500000000C~20260327162350.0000000\"",
            "Product": "15/605/76/2",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623500000000C~20260327162350.0000000\"",
                    "Product": "15/605/76/2",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 605 / 3 INCH 2ND."
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623500000000C~20260327162350.0000000\"",
                    "Product": "15/605/76/2",
                    "Language": "EN",
                    "ProductDescription": "عقلة 605 / 3 بوصة ثاني"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623500000000C~20260327162350.0000000\"",
            "Product": "15/606/20/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623500000000C~20260327162350.0000000\"",
                    "Product": "15/606/20/6",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 606 / 2 INCH (ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623500000000C~20260327162350.0000000\"",
                    "Product": "15/606/20/6",
                    "Language": "EN",
                    "ProductDescription": "عقله 2/606 بوصة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623500000000C~20260327162350.0000000\"",
            "Product": "15/606/51/21",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623500000000C~20260327162350.0000000\"",
                    "Product": "15/606/51/21",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 606 / 2 INCH 2ND."
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623500000000C~20260327162350.0000000\"",
                    "Product": "15/606/51/21",
                    "Language": "EN",
                    "ProductDescription": "عقلة 606 / 2 بوصة ثاني"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623500000000C~20260327162350.0000000\"",
            "Product": "15/606/58/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623500000000C~20260327162350.0000000\"",
                    "Product": "15/606/58/6",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 606/2.25 INCH ALMAZZA"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623500000000C~20260327162350.0000000\"",
                    "Product": "15/606/58/6",
                    "Language": "EN",
                    "ProductDescription": "عقله 2.25/606 بوصة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623490000000C~20260327162349.0000000\"",
            "Product": "15/606/76/2",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623490000000C~20260327162349.0000000\"",
                    "Product": "15/606/76/2",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 606 / 3 INCH 2ND."
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623490000000C~20260327162349.0000000\"",
                    "Product": "15/606/76/2",
                    "Language": "EN",
                    "ProductDescription": "عقلة 606 / 3 بوصة ثاني"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623490000000C~20260327162349.0000000\"",
            "Product": "15/606/76/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623490000000C~20260327162349.0000000\"",
                    "Product": "15/606/76/64",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 606/3 INCH (ALMAZZA) L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623490000000C~20260327162349.0000000\"",
                    "Product": "15/606/76/64",
                    "Language": "EN",
                    "ProductDescription": "عقله 3/606 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702130000000C~20260326170213.0000000\"",
            "Product": "15/610/10/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702130000000C~20260326170213.0000000\"",
                    "Product": "15/610/10/555",
                    "Language": "AR",
                    "ProductDescription": "PENDELOGUE 610/10 INCH Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702130000000C~20260326170213.0000000\"",
                    "Product": "15/610/10/555",
                    "Language": "EN",
                    "ProductDescription": "عقلة 10/610 رينبو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702130000000C~20260326170213.0000000\"",
            "Product": "15/610/10/66",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702130000000C~20260326170213.0000000\"",
                    "Product": "15/610/10/66",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 610/10 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702130000000C~20260326170213.0000000\"",
                    "Product": "15/610/10/66",
                    "Language": "EN",
                    "ProductDescription": "عقله 10/610 بوصه درجه موحده"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702130000000C~20260326170213.0000000\"",
            "Product": "15/610/12/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702130000000C~20260326170213.0000000\"",
                    "Product": "15/610/12/6",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 610/12 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702130000000C~20260326170213.0000000\"",
                    "Product": "15/610/12/6",
                    "Language": "EN",
                    "ProductDescription": "عقله 12/610 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623490000000C~20260327162349.0000000\"",
            "Product": "15/610/25/3334",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623490000000C~20260327162349.0000000\"",
                    "Product": "15/610/25/3334",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 610/2.5 Inch L.Collection L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623490000000C~20260327162349.0000000\"",
                    "Product": "15/610/25/3334",
                    "Language": "EN",
                    "ProductDescription": "عقلة  2.5/610 بوصة درجة L.Collection بال"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623490000000C~20260327162349.0000000\"",
            "Product": "15/610/25/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623490000000C~20260327162349.0000000\"",
                    "Product": "15/610/25/555",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 610/2.5 Inch Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623490000000C~20260327162349.0000000\"",
                    "Product": "15/610/25/555",
                    "Language": "EN",
                    "ProductDescription": "عقلة   610/2.5  RainBow"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623490000000C~20260327162349.0000000\"",
            "Product": "15/610/25/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623490000000C~20260327162349.0000000\"",
                    "Product": "15/610/25/5554",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 610/2.5 Inch Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623490000000C~20260327162349.0000000\"",
                    "Product": "15/610/25/5554",
                    "Language": "EN",
                    "ProductDescription": "عقلة 2.5/610 بوصة درجة RAINBOW باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623480000000C~20260327162348.0000000\"",
            "Product": "15/610/25/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623480000000C~20260327162348.0000000\"",
                    "Product": "15/610/25/64",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 610/2.5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623480000000C~20260327162348.0000000\"",
                    "Product": "15/610/25/64",
                    "Language": "EN",
                    "ProductDescription": "عقلة  2.5/610 بوصة درجة موحدة  باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702120000000C~20260326170212.0000000\"",
            "Product": "15/610/30/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702120000000C~20260326170212.0000000\"",
                    "Product": "15/610/30/555",
                    "Language": "AR",
                    "ProductDescription": "عقلة   610/3  RainBow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702120000000C~20260326170212.0000000\"",
                    "Product": "15/610/30/555",
                    "Language": "EN",
                    "ProductDescription": "عقلة   610/3  RainBow"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623480000000C~20260327162348.0000000\"",
            "Product": "15/610/30/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623480000000C~20260327162348.0000000\"",
                    "Product": "15/610/30/5554",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 610/3 Inch Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623480000000C~20260327162348.0000000\"",
                    "Product": "15/610/30/5554",
                    "Language": "EN",
                    "ProductDescription": "عقلة 3/610 RAINBOW  باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623480000000C~20260327162348.0000000\"",
            "Product": "15/610/30/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623480000000C~20260327162348.0000000\"",
                    "Product": "15/610/30/64",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 610/3 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623480000000C~20260327162348.0000000\"",
                    "Product": "15/610/30/64",
                    "Language": "EN",
                    "ProductDescription": "عقلة 3/610 بوصة درجة موحدة  باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702110000000C~20260326170211.0000000\"",
            "Product": "15/610/40/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702110000000C~20260326170211.0000000\"",
                    "Product": "15/610/40/5554",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 610 / 4 INCH Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702110000000C~20260326170211.0000000\"",
                    "Product": "15/610/40/5554",
                    "Language": "EN",
                    "ProductDescription": "عقلة 4/610 بوصة درجة RAINBOW باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702110000000C~20260326170211.0000000\"",
            "Product": "15/610/40/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702110000000C~20260326170211.0000000\"",
                    "Product": "15/610/40/6",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 610 / 4 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702110000000C~20260326170211.0000000\"",
                    "Product": "15/610/40/6",
                    "Language": "EN",
                    "ProductDescription": "عقلة 4/610 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623480000000C~20260327162348.0000000\"",
            "Product": "15/610/40/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623480000000C~20260327162348.0000000\"",
                    "Product": "15/610/40/64",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 610/4 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623480000000C~20260327162348.0000000\"",
                    "Product": "15/610/40/64",
                    "Language": "EN",
                    "ProductDescription": "عقله 4/610 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702100000000C~20260326170210.0000000\"",
            "Product": "15/610/60/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702100000000C~20260326170210.0000000\"",
                    "Product": "15/610/60/555",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 610/6 Inch Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702100000000C~20260326170210.0000000\"",
                    "Product": "15/610/60/555",
                    "Language": "EN",
                    "ProductDescription": "عقله 6/610 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702100000000C~20260326170210.0000000\"",
            "Product": "15/610/60/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702100000000C~20260326170210.0000000\"",
                    "Product": "15/610/60/6",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 610 / 6 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702100000000C~20260326170210.0000000\"",
                    "Product": "15/610/60/6",
                    "Language": "EN",
                    "ProductDescription": "عقله 6/610 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702100000000C~20260326170210.0000000\"",
            "Product": "15/610/63/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702100000000C~20260326170210.0000000\"",
                    "Product": "15/610/63/6",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 610 / 2.5 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702100000000C~20260326170210.0000000\"",
                    "Product": "15/610/63/6",
                    "Language": "EN",
                    "ProductDescription": "عقلة 610 / 2.5 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623470000000C~20260327162347.0000000\"",
            "Product": "15/610/76/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623470000000C~20260327162347.0000000\"",
                    "Product": "15/610/76/6",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 610 / 3 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623470000000C~20260327162347.0000000\"",
                    "Product": "15/610/76/6",
                    "Language": "EN",
                    "ProductDescription": "عقلة 610 / 3 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702090000000C~20260326170209.0000000\"",
            "Product": "15/610/80/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702090000000C~20260326170209.0000000\"",
                    "Product": "15/610/80/555",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 610/8 Inch Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702090000000C~20260326170209.0000000\"",
                    "Product": "15/610/80/555",
                    "Language": "EN",
                    "ProductDescription": "عقلة 8/610 بوصة درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702090000000C~20260326170209.0000000\"",
            "Product": "15/610/80/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702090000000C~20260326170209.0000000\"",
                    "Product": "15/610/80/6",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 610 / 8 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702090000000C~20260326170209.0000000\"",
                    "Product": "15/610/80/6",
                    "Language": "EN",
                    "ProductDescription": "عقله 8/610 بوصه درجه موحده"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623470000000C~20260327162347.0000000\"",
            "Product": "15/611/10/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623470000000C~20260327162347.0000000\"",
                    "Product": "15/611/10/555",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 611/10 Inch Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623470000000C~20260327162347.0000000\"",
                    "Product": "15/611/10/555",
                    "Language": "EN",
                    "ProductDescription": "عقلة 10/611 بوصة درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702090000000C~20260326170209.0000000\"",
            "Product": "15/611/10/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702090000000C~20260326170209.0000000\"",
                    "Product": "15/611/10/6",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 611/10 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702090000000C~20260326170209.0000000\"",
                    "Product": "15/611/10/6",
                    "Language": "EN",
                    "ProductDescription": "عقله 10/611 بوصه درجه موحده"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702080000000C~20260326170208.0000000\"",
            "Product": "15/611/12/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702080000000C~20260326170208.0000000\"",
                    "Product": "15/611/12/6",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 611/12 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702080000000C~20260326170208.0000000\"",
                    "Product": "15/611/12/6",
                    "Language": "EN",
                    "ProductDescription": "عقله 12/611 بوصه درجه موحده"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623460000000C~20260327162346.0000000\"",
            "Product": "15/611/25/3334",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623460000000C~20260327162346.0000000\"",
                    "Product": "15/611/25/3334",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 611/ 2.5 Inch L.Collection L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623460000000C~20260327162346.0000000\"",
                    "Product": "15/611/25/3334",
                    "Language": "EN",
                    "ProductDescription": "عقلة 2.5/611 بوصة درجة L.CO باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623460000000C~20260327162346.0000000\"",
            "Product": "15/611/25/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623460000000C~20260327162346.0000000\"",
                    "Product": "15/611/25/555",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 611/2.5 Inch Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623460000000C~20260327162346.0000000\"",
                    "Product": "15/611/25/555",
                    "Language": "EN",
                    "ProductDescription": "عقلة   611/2.5  RainBow"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702080000000C~20260326170208.0000000\"",
            "Product": "15/611/25/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702080000000C~20260326170208.0000000\"",
                    "Product": "15/611/25/5554",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 611/2.5 Inch Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702080000000C~20260326170208.0000000\"",
                    "Product": "15/611/25/5554",
                    "Language": "EN",
                    "ProductDescription": "عقلة 2.5/611 بوصة درجة RAINBOW باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702070000000C~20260326170207.0000000\"",
            "Product": "15/611/25/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702070000000C~20260326170207.0000000\"",
                    "Product": "15/611/25/64",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 611/2.5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702070000000C~20260326170207.0000000\"",
                    "Product": "15/611/25/64",
                    "Language": "EN",
                    "ProductDescription": "عقلة  2.5/611 بوصة درجة موحدة  باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623460000000C~20260327162346.0000000\"",
            "Product": "15/611/30/3334",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623460000000C~20260327162346.0000000\"",
                    "Product": "15/611/30/3334",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 611 / 3 Inch L.Collection L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623460000000C~20260327162346.0000000\"",
                    "Product": "15/611/30/3334",
                    "Language": "EN",
                    "ProductDescription": "عقلة 3/611 بوصة درجة L.collection  باللو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702070000000C~20260326170207.0000000\"",
            "Product": "15/611/30/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702070000000C~20260326170207.0000000\"",
                    "Product": "15/611/30/5554",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 611/3 Inch Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702070000000C~20260326170207.0000000\"",
                    "Product": "15/611/30/5554",
                    "Language": "EN",
                    "ProductDescription": "عقلة 3/611 بوصة درجة RAINBOW باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702070000000C~20260326170207.0000000\"",
            "Product": "15/611/40/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702070000000C~20260326170207.0000000\"",
                    "Product": "15/611/40/5554",
                    "Language": "AR",
                    "ProductDescription": "عقله 4/611 بوصة RAINBOW  باللوجو"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702070000000C~20260326170207.0000000\"",
                    "Product": "15/611/40/5554",
                    "Language": "EN",
                    "ProductDescription": "عقله 4/611 بوصة RAINBOW  باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623450000000C~20260327162345.0000000\"",
            "Product": "15/611/40/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623450000000C~20260327162345.0000000\"",
                    "Product": "15/611/40/6",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 611 / 4 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623450000000C~20260327162345.0000000\"",
                    "Product": "15/611/40/6",
                    "Language": "EN",
                    "ProductDescription": "عقلة 4/611 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623450000000C~20260327162345.0000000\"",
            "Product": "15/611/40/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623450000000C~20260327162345.0000000\"",
                    "Product": "15/611/40/64",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 611/4 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623450000000C~20260327162345.0000000\"",
                    "Product": "15/611/40/64",
                    "Language": "EN",
                    "ProductDescription": "عقله 4/611 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702060000000C~20260326170206.0000000\"",
            "Product": "15/611/60/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702060000000C~20260326170206.0000000\"",
                    "Product": "15/611/60/555",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 611/6 Inch Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702060000000C~20260326170206.0000000\"",
                    "Product": "15/611/60/555",
                    "Language": "EN",
                    "ProductDescription": "عقلة 6/611 بوصة درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702060000000C~20260326170206.0000000\"",
            "Product": "15/611/60/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702060000000C~20260326170206.0000000\"",
                    "Product": "15/611/60/6",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 611/6 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702060000000C~20260326170206.0000000\"",
                    "Product": "15/611/60/6",
                    "Language": "EN",
                    "ProductDescription": "عقله 6/611 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623450000000C~20260327162345.0000000\"",
            "Product": "15/611/63/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623450000000C~20260327162345.0000000\"",
                    "Product": "15/611/63/6",
                    "Language": "AR",
                    "ProductDescription": "PENDELOGUE 611/2.5 INCH ( ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623450000000C~20260327162345.0000000\"",
                    "Product": "15/611/63/6",
                    "Language": "EN",
                    "ProductDescription": "عقلة 611 / 2.5 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623440000000C~20260327162344.0000000\"",
            "Product": "15/611/76/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623440000000C~20260327162344.0000000\"",
                    "Product": "15/611/76/555",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 611/3 Inch Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623440000000C~20260327162344.0000000\"",
                    "Product": "15/611/76/555",
                    "Language": "EN",
                    "ProductDescription": "عقله 3/611 درجه RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702050000000C~20260326170205.0000000\"",
            "Product": "15/611/76/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702050000000C~20260326170205.0000000\"",
                    "Product": "15/611/76/6",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 611 / 3 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702050000000C~20260326170205.0000000\"",
                    "Product": "15/611/76/6",
                    "Language": "EN",
                    "ProductDescription": "عقلة 611 / 3 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623440000000C~20260327162344.0000000\"",
            "Product": "15/611/76/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623440000000C~20260327162344.0000000\"",
                    "Product": "15/611/76/64",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 611/3 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623440000000C~20260327162344.0000000\"",
                    "Product": "15/611/76/64",
                    "Language": "EN",
                    "ProductDescription": "عقلة 3/611 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702040000000C~20260326170204.0000000\"",
            "Product": "15/611/80/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702040000000C~20260326170204.0000000\"",
                    "Product": "15/611/80/6",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 611/8 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702040000000C~20260326170204.0000000\"",
                    "Product": "15/611/80/6",
                    "Language": "EN",
                    "ProductDescription": "عقله 8/611 بوصه درجه موحده"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623440000000C~20260327162344.0000000\"",
            "Product": "15/612/20/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623440000000C~20260327162344.0000000\"",
                    "Product": "15/612/20/64",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 612/ 2  INCH (ALMAZZA ) L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623440000000C~20260327162344.0000000\"",
                    "Product": "15/612/20/64",
                    "Language": "EN",
                    "ProductDescription": "عقله2/612بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623430000000C~20260327162343.0000000\"",
            "Product": "15/612/45/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623430000000C~20260327162343.0000000\"",
                    "Product": "15/612/45/64",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 612/4.5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623430000000C~20260327162343.0000000\"",
                    "Product": "15/612/45/64",
                    "Language": "EN",
                    "ProductDescription": "عقله 4.5/612 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623430000000C~20260327162343.0000000\"",
            "Product": "15/612/50/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623430000000C~20260327162343.0000000\"",
                    "Product": "15/612/50/64",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 612/5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623430000000C~20260327162343.0000000\"",
                    "Product": "15/612/50/64",
                    "Language": "EN",
                    "ProductDescription": "عقله 5/612 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623430000000C~20260327162343.0000000\"",
            "Product": "15/612/58/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623430000000C~20260327162343.0000000\"",
                    "Product": "15/612/58/64",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 612 / 2.25 INCH (ALMAZZA ) L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623430000000C~20260327162343.0000000\"",
                    "Product": "15/612/58/64",
                    "Language": "EN",
                    "ProductDescription": "عقله 2.25/612 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623420000000C~20260327162342.0000000\"",
            "Product": "15/614/45/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623420000000C~20260327162342.0000000\"",
                    "Product": "15/614/45/64",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 614/4.5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623420000000C~20260327162342.0000000\"",
                    "Product": "15/614/45/64",
                    "Language": "EN",
                    "ProductDescription": "عقله 4.5/614 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623420000000C~20260327162342.0000000\"",
            "Product": "15/614/50/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623420000000C~20260327162342.0000000\"",
                    "Product": "15/614/50/64",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 614/5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623420000000C~20260327162342.0000000\"",
                    "Product": "15/614/50/64",
                    "Language": "EN",
                    "ProductDescription": "عقله 5/614 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623410000000C~20260327162341.0000000\"",
            "Product": "15/616/35/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623410000000C~20260327162341.0000000\"",
                    "Product": "15/616/35/64",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 616/3.5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623410000000C~20260327162341.0000000\"",
                    "Product": "15/616/35/64",
                    "Language": "EN",
                    "ProductDescription": "عقله 3.5/616 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623410000000C~20260327162341.0000000\"",
            "Product": "15/616/45/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623410000000C~20260327162341.0000000\"",
                    "Product": "15/616/45/64",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 616/4.5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623410000000C~20260327162341.0000000\"",
                    "Product": "15/616/45/64",
                    "Language": "EN",
                    "ProductDescription": "عقله 4.5/616 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623410000000C~20260327162341.0000000\"",
            "Product": "15/616/50/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623410000000C~20260327162341.0000000\"",
                    "Product": "15/616/50/64",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 616/5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623410000000C~20260327162341.0000000\"",
                    "Product": "15/616/50/64",
                    "Language": "EN",
                    "ProductDescription": "عقله 5/616 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623410000000C~20260327162341.0000000\"",
            "Product": "15/616/55/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623410000000C~20260327162341.0000000\"",
                    "Product": "15/616/55/64",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 616/5.5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623410000000C~20260327162341.0000000\"",
                    "Product": "15/616/55/64",
                    "Language": "EN",
                    "ProductDescription": "عقله 5.5/616 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702020000000C~20260326170202.0000000\"",
            "Product": "15/618/25/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702020000000C~20260326170202.0000000\"",
                    "Product": "15/618/25/64",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 618 / 2.5 INCH (ALMAZZA ) L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702020000000C~20260326170202.0000000\"",
                    "Product": "15/618/25/64",
                    "Language": "EN",
                    "ProductDescription": "عقله 2.5/618 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702010000000C~20260326170201.0000000\"",
            "Product": "15/618/35/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702010000000C~20260326170201.0000000\"",
                    "Product": "15/618/35/64",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 618/3.5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702010000000C~20260326170201.0000000\"",
                    "Product": "15/618/35/64",
                    "Language": "EN",
                    "ProductDescription": "عقله 3.5/618 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623400000000C~20260327162340.0000000\"",
            "Product": "15/618/45/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623400000000C~20260327162340.0000000\"",
                    "Product": "15/618/45/64",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 618/4.5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623400000000C~20260327162340.0000000\"",
                    "Product": "15/618/45/64",
                    "Language": "EN",
                    "ProductDescription": "عقله 4.5/618 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623400000000C~20260327162340.0000000\"",
            "Product": "15/618/50/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623400000000C~20260327162340.0000000\"",
                    "Product": "15/618/50/64",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 618/5 INCH (ALMAZZA) L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623400000000C~20260327162340.0000000\"",
                    "Product": "15/618/50/64",
                    "Language": "EN",
                    "ProductDescription": "عقله 5/618 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623400000000C~20260327162340.0000000\"",
            "Product": "15/618/55/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623400000000C~20260327162340.0000000\"",
                    "Product": "15/618/55/64",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 618/5.5 INCH (ALMAZZA) L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623400000000C~20260327162340.0000000\"",
                    "Product": "15/618/55/64",
                    "Language": "EN",
                    "ProductDescription": "عقله 5.5/618 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623400000000C~20260327162340.0000000\"",
            "Product": "15/618/58/664",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623400000000C~20260327162340.0000000\"",
                    "Product": "15/618/58/664",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 618 / 2.25 INCH (ALMAZZA ) L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623400000000C~20260327162340.0000000\"",
                    "Product": "15/618/58/664",
                    "Language": "EN",
                    "ProductDescription": "عقله 2.25/618 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702000000000C~20260326170200.0000000\"",
            "Product": "15/630/55/54",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702000000000C~20260326170200.0000000\"",
                    "Product": "15/630/55/54",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 630/2.25 Inch Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702000000000C~20260326170200.0000000\"",
                    "Product": "15/630/55/54",
                    "Language": "EN",
                    "ProductDescription": "عقلة 55 / 630 درجة RAINBOW باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623390000000C~20260327162339.0000000\"",
            "Product": "15/630/55/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623390000000C~20260327162339.0000000\"",
                    "Product": "15/630/55/555",
                    "Language": "AR",
                    "ProductDescription": "PENDELOGUE 630/55 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623390000000C~20260327162339.0000000\"",
                    "Product": "15/630/55/555",
                    "Language": "EN",
                    "ProductDescription": "عقلة55/630 rainbow"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702000000000C~20260326170200.0000000\"",
            "Product": "15/630/55/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702000000000C~20260326170200.0000000\"",
                    "Product": "15/630/55/6",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 630 / 2.25 INCH (ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702000000000C~20260326170200.0000000\"",
                    "Product": "15/630/55/6",
                    "Language": "EN",
                    "ProductDescription": "عقلة 55/630 مللى درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261702000000000C~20260326170200.0000000\"",
            "Product": "15/630/55/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261702000000000C~20260326170200.0000000\"",
                    "Product": "15/630/55/64",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 630/2.25 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261702000000000C~20260326170200.0000000\"",
                    "Product": "15/630/55/64",
                    "Language": "EN",
                    "ProductDescription": "عقلة 55 / 630 درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623390000000C~20260327162339.0000000\"",
            "Product": "15/660/40/3334",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623390000000C~20260327162339.0000000\"",
                    "Product": "15/660/40/3334",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 660 / 4 INCH L.Collection L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623390000000C~20260327162339.0000000\"",
                    "Product": "15/660/40/3334",
                    "Language": "EN",
                    "ProductDescription": "عقلة 660/4 بوصة درجة L.CO باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623380000000C~20260327162338.0000000\"",
            "Product": "15/661/40/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623380000000C~20260327162338.0000000\"",
                    "Product": "15/661/40/64",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 661/ 4 INCH (ALMAZZA ) L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623380000000C~20260327162338.0000000\"",
                    "Product": "15/661/40/64",
                    "Language": "EN",
                    "ProductDescription": "عقله 661/4 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623380000000C~20260327162338.0000000\"",
            "Product": "15/670/40/3334",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623380000000C~20260327162338.0000000\"",
                    "Product": "15/670/40/3334",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 670 / 4 INCH L.Collection L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623380000000C~20260327162338.0000000\"",
                    "Product": "15/670/40/3334",
                    "Language": "EN",
                    "ProductDescription": "عقلة 670/4 بوصة درجة L.CO باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623380000000C~20260327162338.0000000\"",
            "Product": "15/670/40/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623380000000C~20260327162338.0000000\"",
                    "Product": "15/670/40/64",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 670/ 4 INCH (ALMAZZA ) L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623380000000C~20260327162338.0000000\"",
                    "Product": "15/670/40/64",
                    "Language": "EN",
                    "ProductDescription": "عقلة 4 / 670 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623380000000C~20260327162338.0000000\"",
            "Product": "15/671/40/3334",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623380000000C~20260327162338.0000000\"",
                    "Product": "15/671/40/3334",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 671 / 4 INCH L.Collection L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623380000000C~20260327162338.0000000\"",
                    "Product": "15/671/40/3334",
                    "Language": "EN",
                    "ProductDescription": "عقلة 671/4 بوصة درجة L.CO باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623380000000C~20260327162338.0000000\"",
            "Product": "15/671/40/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623380000000C~20260327162338.0000000\"",
                    "Product": "15/671/40/64",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 671/ 4 INCH (ALMAZZA ) L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623380000000C~20260327162338.0000000\"",
                    "Product": "15/671/40/64",
                    "Language": "EN",
                    "ProductDescription": "عقلة 4 / 671 بوصة درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623370000000C~20260327162337.0000000\"",
            "Product": "15/690/30/54",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623370000000C~20260327162337.0000000\"",
                    "Product": "15/690/30/54",
                    "Language": "AR",
                    "ProductDescription": "Pendlogue 690/3 Inch Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623370000000C~20260327162337.0000000\"",
                    "Product": "15/690/30/54",
                    "Language": "EN",
                    "ProductDescription": "عقلة 3/690 بوصة درجة RAIN BOW باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701570000000C~20260326170157.0000000\"",
            "Product": "15/701/100/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701570000000C~20260326170157.0000000\"",
                    "Product": "15/701/100/6",
                    "Language": "AR",
                    "ProductDescription": "Ball 701/100 mm With Pin. Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701570000000C~20260326170157.0000000\"",
                    "Product": "15/701/100/6",
                    "Language": "EN",
                    "ProductDescription": "كرة 701/100 مم موحدة بالجنش"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701560000000C~20260326170156.0000000\"",
            "Product": "15/701/20/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701560000000C~20260326170156.0000000\"",
                    "Product": "15/701/20/5554",
                    "Language": "AR",
                    "ProductDescription": "BALL 701 / 20 MM Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701560000000C~20260326170156.0000000\"",
                    "Product": "15/701/20/5554",
                    "Language": "EN",
                    "ProductDescription": "كرة 701/20 مم درجة RAINBOW باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623370000000C~20260327162337.0000000\"",
            "Product": "15/701/20/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623370000000C~20260327162337.0000000\"",
                    "Product": "15/701/20/6",
                    "Language": "AR",
                    "ProductDescription": "BALL 701 / 20 MM (ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623370000000C~20260327162337.0000000\"",
                    "Product": "15/701/20/6",
                    "Language": "EN",
                    "ProductDescription": "كرة 701 / 20 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701560000000C~20260326170156.0000000\"",
            "Product": "15/701/20/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701560000000C~20260326170156.0000000\"",
                    "Product": "15/701/20/64",
                    "Language": "AR",
                    "ProductDescription": "Ball 701/20 mm Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701560000000C~20260326170156.0000000\"",
                    "Product": "15/701/20/64",
                    "Language": "EN",
                    "ProductDescription": "كرة 701/20 مم درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623360000000C~20260327162336.0000000\"",
            "Product": "15/701/30/534",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623360000000C~20260327162336.0000000\"",
                    "Product": "15/701/30/534",
                    "Language": "AR",
                    "ProductDescription": "BALL 701/30 mm Rainbow Plas L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623360000000C~20260327162336.0000000\"",
                    "Product": "15/701/30/534",
                    "Language": "EN",
                    "ProductDescription": "كرة 701/30  باللوجو  RAINBOW  بلاس"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701550000000C~20260326170155.0000000\"",
            "Product": "15/701/30/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701550000000C~20260326170155.0000000\"",
                    "Product": "15/701/30/555",
                    "Language": "AR",
                    "ProductDescription": "Ball 701/30 MM Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701550000000C~20260326170155.0000000\"",
                    "Product": "15/701/30/555",
                    "Language": "EN",
                    "ProductDescription": "كرة 701 / 30 مم Rain Bow"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701550000000C~20260326170155.0000000\"",
            "Product": "15/701/30/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701550000000C~20260326170155.0000000\"",
                    "Product": "15/701/30/5554",
                    "Language": "AR",
                    "ProductDescription": "Ball 701/30 mm Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701550000000C~20260326170155.0000000\"",
                    "Product": "15/701/30/5554",
                    "Language": "EN",
                    "ProductDescription": "كرة 701/30 مم RAINBOW L"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701550000000C~20260326170155.0000000\"",
            "Product": "15/701/30/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701550000000C~20260326170155.0000000\"",
                    "Product": "15/701/30/6",
                    "Language": "AR",
                    "ProductDescription": "BALL 701 / 30 MM (ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701550000000C~20260326170155.0000000\"",
                    "Product": "15/701/30/6",
                    "Language": "EN",
                    "ProductDescription": "كرة 701 / 30 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701550000000C~20260326170155.0000000\"",
            "Product": "15/701/30/6664",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701550000000C~20260326170155.0000000\"",
                    "Product": "15/701/30/6664",
                    "Language": "AR",
                    "ProductDescription": "Ball 701/30 mm Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701550000000C~20260326170155.0000000\"",
                    "Product": "15/701/30/6664",
                    "Language": "EN",
                    "ProductDescription": "كرة 30 /701  درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623360000000C~20260327162336.0000000\"",
            "Product": "15/701/40/53",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623360000000C~20260327162336.0000000\"",
                    "Product": "15/701/40/53",
                    "Language": "AR",
                    "ProductDescription": "BALL 701 / 40 mm Rainbow Plas L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623360000000C~20260327162336.0000000\"",
                    "Product": "15/701/40/53",
                    "Language": "EN",
                    "ProductDescription": "كرة 40 /701   باللوجو  RAINBOW  بلاس"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623360000000C~20260327162336.0000000\"",
            "Product": "15/701/40/5555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623360000000C~20260327162336.0000000\"",
                    "Product": "15/701/40/5555",
                    "Language": "AR",
                    "ProductDescription": "Ball 701 / 40 mm Rainbow L.S"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623360000000C~20260327162336.0000000\"",
                    "Product": "15/701/40/5555",
                    "Language": "EN",
                    "ProductDescription": "كرة 40 /701 RAINBOW استاندرد باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701530000000C~20260326170153.0000000\"",
            "Product": "15/701/40/6664",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701530000000C~20260326170153.0000000\"",
                    "Product": "15/701/40/6664",
                    "Language": "AR",
                    "ProductDescription": "BALL 701 / 40 MM ( ALMAZZA ) L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701530000000C~20260326170153.0000000\"",
                    "Product": "15/701/40/6664",
                    "Language": "EN",
                    "ProductDescription": "كرة 701 / 40 مم درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623360000000C~20260327162336.0000000\"",
            "Product": "15/701/40/6665",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623360000000C~20260327162336.0000000\"",
                    "Product": "15/701/40/6665",
                    "Language": "AR",
                    "ProductDescription": "Ball 701/40 mm Almazza L.S"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623360000000C~20260327162336.0000000\"",
                    "Product": "15/701/40/6665",
                    "Language": "EN",
                    "ProductDescription": "كرة 40/701 درجة موحدة استاندرد باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623350000000C~20260327162335.0000000\"",
            "Product": "15/701/50/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623350000000C~20260327162335.0000000\"",
                    "Product": "15/701/50/333",
                    "Language": "AR",
                    "ProductDescription": "BALL 701/50 mm L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623350000000C~20260327162335.0000000\"",
                    "Product": "15/701/50/333",
                    "Language": "EN",
                    "ProductDescription": "كرة 701 / 50 مم L.Collection"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701520000000C~20260326170152.0000000\"",
            "Product": "15/701/50/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701520000000C~20260326170152.0000000\"",
                    "Product": "15/701/50/5554",
                    "Language": "AR",
                    "ProductDescription": "BALL 701 / 50 mm Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701520000000C~20260326170152.0000000\"",
                    "Product": "15/701/50/5554",
                    "Language": "EN",
                    "ProductDescription": "كرة 701/50 مم درجة RainBow باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701520000000C~20260326170152.0000000\"",
            "Product": "15/701/50/5555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701520000000C~20260326170152.0000000\"",
                    "Product": "15/701/50/5555",
                    "Language": "AR",
                    "ProductDescription": "كرة 50/ 701 مم RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701520000000C~20260326170152.0000000\"",
                    "Product": "15/701/50/5555",
                    "Language": "EN",
                    "ProductDescription": "كرة 50/ 701 مم RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623350000000C~20260327162335.0000000\"",
            "Product": "15/701/50/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623350000000C~20260327162335.0000000\"",
                    "Product": "15/701/50/6",
                    "Language": "AR",
                    "ProductDescription": "BALL 701 / 50 MM (ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623350000000C~20260327162335.0000000\"",
                    "Product": "15/701/50/6",
                    "Language": "EN",
                    "ProductDescription": "كرة 701 / 50 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623350000000C~20260327162335.0000000\"",
            "Product": "15/701/50/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623350000000C~20260327162335.0000000\"",
                    "Product": "15/701/50/64",
                    "Language": "AR",
                    "ProductDescription": "Ball 701/50 mm ALmazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623350000000C~20260327162335.0000000\"",
                    "Product": "15/701/50/64",
                    "Language": "EN",
                    "ProductDescription": "كرة 701/50 درجة موحدة  باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701510000000C~20260326170151.0000000\"",
            "Product": "15/701/60/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701510000000C~20260326170151.0000000\"",
                    "Product": "15/701/60/555",
                    "Language": "AR",
                    "ProductDescription": "Ball 701/60 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701510000000C~20260326170151.0000000\"",
                    "Product": "15/701/60/555",
                    "Language": "EN",
                    "ProductDescription": "كرة 701/60 مم  درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701510000000C~20260326170151.0000000\"",
            "Product": "15/701/60/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701510000000C~20260326170151.0000000\"",
                    "Product": "15/701/60/5554",
                    "Language": "AR",
                    "ProductDescription": "كرة 60/701 درجة RAINBOW بالوجو"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701510000000C~20260326170151.0000000\"",
                    "Product": "15/701/60/5554",
                    "Language": "EN",
                    "ProductDescription": "كرة 60/701 درجة RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701510000000C~20260326170151.0000000\"",
            "Product": "15/701/60/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701510000000C~20260326170151.0000000\"",
                    "Product": "15/701/60/6",
                    "Language": "AR",
                    "ProductDescription": "BALL 701 / 60 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701510000000C~20260326170151.0000000\"",
                    "Product": "15/701/60/6",
                    "Language": "EN",
                    "ProductDescription": "كرة 701/60 مم موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701510000000C~20260326170151.0000000\"",
            "Product": "15/701/60/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701510000000C~20260326170151.0000000\"",
                    "Product": "15/701/60/64",
                    "Language": "AR",
                    "ProductDescription": "BALL 701/60 mm Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701510000000C~20260326170151.0000000\"",
                    "Product": "15/701/60/64",
                    "Language": "EN",
                    "ProductDescription": "كرة 701/60 مم موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701500000000C~20260326170150.0000000\"",
            "Product": "15/701/70/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701500000000C~20260326170150.0000000\"",
                    "Product": "15/701/70/5554",
                    "Language": "AR",
                    "ProductDescription": "كرة 70/701 درجه RAINBOW بالوجو"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701500000000C~20260326170150.0000000\"",
                    "Product": "15/701/70/5554",
                    "Language": "EN",
                    "ProductDescription": "كرة 70/701 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701500000000C~20260326170150.0000000\"",
            "Product": "15/701/70/664",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701500000000C~20260326170150.0000000\"",
                    "Product": "15/701/70/664",
                    "Language": "AR",
                    "ProductDescription": "Ball 701/70 mm ALmazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701500000000C~20260326170150.0000000\"",
                    "Product": "15/701/70/664",
                    "Language": "EN",
                    "ProductDescription": "كرة 70 /701 مم موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623340000000C~20260327162334.0000000\"",
            "Product": "15/70182/4014/5555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623340000000C~20260327162334.0000000\"",
                    "Product": "15/70182/4014/5555",
                    "Language": "AR",
                    "ProductDescription": "BALL 701/40 RAINBOW L S +1082 / 14 L.C"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623340000000C~20260327162334.0000000\"",
                    "Product": "15/70182/4014/5555",
                    "Language": "EN",
                    "ProductDescription": "كرة 40 /701 RAINBOW استاندرد باللوجو + 1"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701490000000C~20260326170149.0000000\"",
            "Product": "15/710/20/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701490000000C~20260326170149.0000000\"",
                    "Product": "15/710/20/6",
                    "Language": "AR",
                    "ProductDescription": "BALL 710/20 mm ALmazza V.H"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701490000000C~20260326170149.0000000\"",
                    "Product": "15/710/20/6",
                    "Language": "EN",
                    "ProductDescription": "كرة 710/20 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701480000000C~20260326170148.0000000\"",
            "Product": "15/710/30/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701480000000C~20260326170148.0000000\"",
                    "Product": "15/710/30/555",
                    "Language": "AR",
                    "ProductDescription": "BALL 710/30 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701480000000C~20260326170148.0000000\"",
                    "Product": "15/710/30/555",
                    "Language": "EN",
                    "ProductDescription": "كره 710/30 درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701480000000C~20260326170148.0000000\"",
            "Product": "15/710/30/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701480000000C~20260326170148.0000000\"",
                    "Product": "15/710/30/6",
                    "Language": "AR",
                    "ProductDescription": "Ball 710 / 30 mm ALmazza V.H"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701480000000C~20260326170148.0000000\"",
                    "Product": "15/710/30/6",
                    "Language": "EN",
                    "ProductDescription": "كرة  30 /710  درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623340000000C~20260327162334.0000000\"",
            "Product": "15/710/30/66",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623340000000C~20260327162334.0000000\"",
                    "Product": "15/710/30/66",
                    "Language": "AR",
                    "ProductDescription": "Ball 710 / 30 mm C.H 12 mm ALmazza V.H"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623340000000C~20260327162334.0000000\"",
                    "Product": "15/710/30/66",
                    "Language": "EN",
                    "ProductDescription": "كرة 30 / 710 درجة موحدة وسط 12 مم"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701480000000C~20260326170148.0000000\"",
            "Product": "15/710/40/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701480000000C~20260326170148.0000000\"",
                    "Product": "15/710/40/555",
                    "Language": "AR",
                    "ProductDescription": "BALL 710/40  mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701480000000C~20260326170148.0000000\"",
                    "Product": "15/710/40/555",
                    "Language": "EN",
                    "ProductDescription": "كره 710/40  درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701480000000C~20260326170148.0000000\"",
            "Product": "15/710/40/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701480000000C~20260326170148.0000000\"",
                    "Product": "15/710/40/6",
                    "Language": "AR",
                    "ProductDescription": "BALL 710/40 mm ALmazza V.H"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701480000000C~20260326170148.0000000\"",
                    "Product": "15/710/40/6",
                    "Language": "EN",
                    "ProductDescription": "كرة  40 /710  درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701470000000C~20260326170147.0000000\"",
            "Product": "15/710/50/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701470000000C~20260326170147.0000000\"",
                    "Product": "15/710/50/555",
                    "Language": "AR",
                    "ProductDescription": "BALL 710/50 MM. Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701470000000C~20260326170147.0000000\"",
                    "Product": "15/710/50/555",
                    "Language": "EN",
                    "ProductDescription": "كرة 50/710 درجة Rainbow"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701470000000C~20260326170147.0000000\"",
            "Product": "15/710/50/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701470000000C~20260326170147.0000000\"",
                    "Product": "15/710/50/6",
                    "Language": "AR",
                    "ProductDescription": "Ball 710/50 mm ALmazza V.H"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701470000000C~20260326170147.0000000\"",
                    "Product": "15/710/50/6",
                    "Language": "EN",
                    "ProductDescription": "كرة 50/710 درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701470000000C~20260326170147.0000000\"",
            "Product": "15/710/60/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701470000000C~20260326170147.0000000\"",
                    "Product": "15/710/60/555",
                    "Language": "AR",
                    "ProductDescription": "BALL 710 / 60 mm Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701470000000C~20260326170147.0000000\"",
                    "Product": "15/710/60/555",
                    "Language": "EN",
                    "ProductDescription": "كرة 710/60 مم درجة RainBow"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701470000000C~20260326170147.0000000\"",
            "Product": "15/710/60/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701470000000C~20260326170147.0000000\"",
                    "Product": "15/710/60/6",
                    "Language": "AR",
                    "ProductDescription": "BALL 710 / 60 MM ( ALMAZZA ) V.H"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701470000000C~20260326170147.0000000\"",
                    "Product": "15/710/60/6",
                    "Language": "EN",
                    "ProductDescription": "كرة 710/60 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701460000000C~20260326170146.0000000\"",
            "Product": "15/710/70/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701460000000C~20260326170146.0000000\"",
                    "Product": "15/710/70/6",
                    "Language": "AR",
                    "ProductDescription": "Ball 710 / 70 mm ALmazza V.H"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701460000000C~20260326170146.0000000\"",
                    "Product": "15/710/70/6",
                    "Language": "EN",
                    "ProductDescription": "كرة  710/70  درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701450000000C~20260326170145.0000000\"",
            "Product": "15/730/40/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701450000000C~20260326170145.0000000\"",
                    "Product": "15/730/40/64",
                    "Language": "AR",
                    "ProductDescription": "Ball 730/40 mm Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701450000000C~20260326170145.0000000\"",
                    "Product": "15/730/40/64",
                    "Language": "EN",
                    "ProductDescription": "كورة730/40  درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701450000000C~20260326170145.0000000\"",
            "Product": "15/740/30/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701450000000C~20260326170145.0000000\"",
                    "Product": "15/740/30/64",
                    "Language": "AR",
                    "ProductDescription": "Ball 740/30 mm Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701450000000C~20260326170145.0000000\"",
                    "Product": "15/740/30/64",
                    "Language": "EN",
                    "ProductDescription": "كورة740/30  درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623330000000C~20260327162333.0000000\"",
            "Product": "15/740/40/3334",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623330000000C~20260327162333.0000000\"",
                    "Product": "15/740/40/3334",
                    "Language": "AR",
                    "ProductDescription": "Ball 740/40 mm L.Collection L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623330000000C~20260327162333.0000000\"",
                    "Product": "15/740/40/3334",
                    "Language": "EN",
                    "ProductDescription": "كورة740/40 درجة L.COLLECTION.L"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701440000000C~20260326170144.0000000\"",
            "Product": "15/740/40/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701440000000C~20260326170144.0000000\"",
                    "Product": "15/740/40/5554",
                    "Language": "AR",
                    "ProductDescription": "Ball 740/40 mm Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701440000000C~20260326170144.0000000\"",
                    "Product": "15/740/40/5554",
                    "Language": "EN",
                    "ProductDescription": "كورة740/40  درجة  RAINBOW باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623330000000C~20260327162333.0000000\"",
            "Product": "15/740/40/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623330000000C~20260327162333.0000000\"",
                    "Product": "15/740/40/64",
                    "Language": "AR",
                    "ProductDescription": "Ball 740/40 mm Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623330000000C~20260327162333.0000000\"",
                    "Product": "15/740/40/64",
                    "Language": "EN",
                    "ProductDescription": "كورة740/40  درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701440000000C~20260326170144.0000000\"",
            "Product": "15/740/50/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701440000000C~20260326170144.0000000\"",
                    "Product": "15/740/50/5554",
                    "Language": "AR",
                    "ProductDescription": "كورة 740/50 درجة RAINBOW  باللوجو"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701440000000C~20260326170144.0000000\"",
                    "Product": "15/740/50/5554",
                    "Language": "EN",
                    "ProductDescription": "كورة 740/50 درجة RAINBOW  باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701440000000C~20260326170144.0000000\"",
            "Product": "15/740/50/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701440000000C~20260326170144.0000000\"",
                    "Product": "15/740/50/64",
                    "Language": "AR",
                    "ProductDescription": "Ball 740/50 mm Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701440000000C~20260326170144.0000000\"",
                    "Product": "15/740/50/64",
                    "Language": "EN",
                    "ProductDescription": "كورة740/50  درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623300000000C~20260327162330.0000000\"",
            "Product": "15/776/30/664",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623300000000C~20260327162330.0000000\"",
                    "Product": "15/776/30/664",
                    "Language": "AR",
                    "ProductDescription": "Ball Masa 776/30 mm Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623300000000C~20260327162330.0000000\"",
                    "Product": "15/776/30/664",
                    "Language": "EN",
                    "ProductDescription": "ماسة 30 / 776 درجة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623290000000C~20260327162329.0000000\"",
            "Product": "15/776/40/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623290000000C~20260327162329.0000000\"",
                    "Product": "15/776/40/64",
                    "Language": "AR",
                    "ProductDescription": "Ball Masa 776/40 mm Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623290000000C~20260327162329.0000000\"",
                    "Product": "15/776/40/64",
                    "Language": "EN",
                    "ProductDescription": "ماسة 40/ 776 درجه موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701280000000C~20260326170128.0000000\"",
            "Product": "15/8/52/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701280000000C~20260326170128.0000000\"",
                    "Product": "15/8/52/555",
                    "Language": "AR",
                    "ProductDescription": "BEAD 1502 /8 MM Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701280000000C~20260326170128.0000000\"",
                    "Product": "15/8/52/555",
                    "Language": "EN",
                    "ProductDescription": "سبحة 8 /1502 Rainbow"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701280000000C~20260326170128.0000000\"",
            "Product": "15/8/52/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701280000000C~20260326170128.0000000\"",
                    "Product": "15/8/52/6",
                    "Language": "AR",
                    "ProductDescription": "Bead 1502 / 8 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701280000000C~20260326170128.0000000\"",
                    "Product": "15/8/52/6",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1502 / 8 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623280000000C~20260327162328.0000000\"",
            "Product": "15/8/53/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623280000000C~20260327162328.0000000\"",
                    "Product": "15/8/53/6",
                    "Language": "AR",
                    "ProductDescription": "BEAD 1503/8 MM(Almazza )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623280000000C~20260327162328.0000000\"",
                    "Product": "15/8/53/6",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1503/8 بيضاوى درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701270000000C~20260326170127.0000000\"",
            "Product": "15/8/54/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701270000000C~20260326170127.0000000\"",
                    "Product": "15/8/54/6",
                    "Language": "AR",
                    "ProductDescription": "BEAD 1504/8 MM(Almazza )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701270000000C~20260326170127.0000000\"",
                    "Product": "15/8/54/6",
                    "Language": "EN",
                    "ProductDescription": "سبحة 1504/8 بيضاوى درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623270000000C~20260327162327.0000000\"",
            "Product": "15/870/28/2",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623270000000C~20260327162327.0000000\"",
                    "Product": "15/870/28/2",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 870 / 28 MM 2ND."
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623270000000C~20260327162327.0000000\"",
                    "Product": "15/870/28/2",
                    "Language": "EN",
                    "ProductDescription": "لوزة 870 / 28 مم ثاني"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623270000000C~20260327162327.0000000\"",
            "Product": "15/870/28/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623270000000C~20260327162327.0000000\"",
                    "Product": "15/870/28/333",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 870 / 28  INCH L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623270000000C~20260327162327.0000000\"",
                    "Product": "15/870/28/333",
                    "Language": "EN",
                    "ProductDescription": "لوزه 28/870مم L.COLLECTION"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623260000000C~20260327162326.0000000\"",
            "Product": "15/870/28/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623260000000C~20260327162326.0000000\"",
                    "Product": "15/870/28/6",
                    "Language": "AR",
                    "ProductDescription": "Pearshape 870/28 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623260000000C~20260327162326.0000000\"",
                    "Product": "15/870/28/6",
                    "Language": "EN",
                    "ProductDescription": "لوزة 870 / 28 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701250000000C~20260326170125.0000000\"",
            "Product": "15/870/40/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701250000000C~20260326170125.0000000\"",
                    "Product": "15/870/40/6",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 870/40 mm Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701250000000C~20260326170125.0000000\"",
                    "Product": "15/870/40/6",
                    "Language": "EN",
                    "ProductDescription": "لوزة 870 / 40 مم درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623260000000C~20260327162326.0000000\"",
            "Product": "15/872/15/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623260000000C~20260327162326.0000000\"",
                    "Product": "15/872/15/333",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 872 /1.5 Inch L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623260000000C~20260327162326.0000000\"",
                    "Product": "15/872/15/333",
                    "Language": "EN",
                    "ProductDescription": "لوزه 1.5/872 بوصه L.COLLECTION"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701240000000C~20260326170124.0000000\"",
            "Product": "15/872/15/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701240000000C~20260326170124.0000000\"",
                    "Product": "15/872/15/555",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 872 / 1.5 Inch Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701240000000C~20260326170124.0000000\"",
                    "Product": "15/872/15/555",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701240000000C~20260326170124.0000000\"",
            "Product": "15/872/15/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701240000000C~20260326170124.0000000\"",
                    "Product": "15/872/15/5554",
                    "Language": "AR",
                    "ProductDescription": "Pearshape 872 / 1.5 Inch Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701240000000C~20260326170124.0000000\"",
                    "Product": "15/872/15/5554",
                    "Language": "EN",
                    "ProductDescription": "لوزه 1.5/872 درجة RAINBOW  بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
            "Product": "15/872/15/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
                    "Product": "15/872/15/6",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 872 / 1.5 INCH (ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
                    "Product": "15/872/15/6",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701230000000C~20260326170123.0000000\"",
            "Product": "15/872/15/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701230000000C~20260326170123.0000000\"",
                    "Product": "15/872/15/64",
                    "Language": "AR",
                    "ProductDescription": "Pearshape 872/1.5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701230000000C~20260326170123.0000000\"",
                    "Product": "15/872/15/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
            "Product": "15/872/2/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
                    "Product": "15/872/2/6",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 872/2 Inch ( ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
                    "Product": "15/872/2/6",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
            "Product": "15/872/20/3334",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
                    "Product": "15/872/20/3334",
                    "Language": "AR",
                    "ProductDescription": "Pearshape 872/2 Inch L.Collection L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
                    "Product": "15/872/20/3334",
                    "Language": "EN",
                    "ProductDescription": "لوزة 872/2 بوصة درجة L.CO باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
            "Product": "15/872/20/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
                    "Product": "15/872/20/5554",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 872/2 Inch Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
                    "Product": "15/872/20/5554",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701220000000C~20260326170122.0000000\"",
            "Product": "15/872/20/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701220000000C~20260326170122.0000000\"",
                    "Product": "15/872/20/64",
                    "Language": "AR",
                    "ProductDescription": "Pearshape 872/2 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701220000000C~20260326170122.0000000\"",
                    "Product": "15/872/20/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
            "Product": "15/872/25/33334",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
                    "Product": "15/872/25/33334",
                    "Language": "AR",
                    "ProductDescription": "PENDLOGUE 872/2.5 L.COLLECTION  L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
                    "Product": "15/872/25/33334",
                    "Language": "EN",
                    "ProductDescription": "لوزة 872/2.5 بوصة درجة L.CO باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
            "Product": "15/872/25/3334",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
                    "Product": "15/872/25/3334",
                    "Language": "AR",
                    "ProductDescription": "Pearshape 872/2.5  L.COLLECTION L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
                    "Product": "15/872/25/3334",
                    "Language": "EN",
                    "ProductDescription": "لوزه 2.5/872 L.COLLECTION L"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
            "Product": "15/872/25/5551",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
                    "Product": "15/872/25/5551",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 872 / 2.5 INCH RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623250000000C~20260327162325.0000000\"",
                    "Product": "15/872/25/5551",
                    "Language": "EN",
                    "ProductDescription": "لوزه 2.5/872 بوصة RAIN"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623240000000C~20260327162324.0000000\"",
            "Product": "15/872/25/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623240000000C~20260327162324.0000000\"",
                    "Product": "15/872/25/5554",
                    "Language": "AR",
                    "ProductDescription": "Pearshape 872/2.5  Inch Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623240000000C~20260327162324.0000000\"",
                    "Product": "15/872/25/5554",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623240000000C~20260327162324.0000000\"",
            "Product": "15/872/25/55554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623240000000C~20260327162324.0000000\"",
                    "Product": "15/872/25/55554",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 872 / 2.5 INCH RAINBOW L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623240000000C~20260327162324.0000000\"",
                    "Product": "15/872/25/55554",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701210000000C~20260326170121.0000000\"",
            "Product": "15/872/25/61",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701210000000C~20260326170121.0000000\"",
                    "Product": "15/872/25/61",
                    "Language": "AR",
                    "ProductDescription": "Pearshape 872/2.5 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701210000000C~20260326170121.0000000\"",
                    "Product": "15/872/25/61",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701200000000C~20260326170120.0000000\"",
            "Product": "15/872/25/6664",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701200000000C~20260326170120.0000000\"",
                    "Product": "15/872/25/6664",
                    "Language": "AR",
                    "ProductDescription": "Pearshape 872/2.5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701200000000C~20260326170120.0000000\"",
                    "Product": "15/872/25/6664",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623240000000C~20260327162324.0000000\"",
            "Product": "15/872/3/61",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623240000000C~20260327162324.0000000\"",
                    "Product": "15/872/3/61",
                    "Language": "AR",
                    "ProductDescription": "(PEARSHAPE 872 / 3 INCH (ALMAZZA"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623240000000C~20260327162324.0000000\"",
                    "Product": "15/872/3/61",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623230000000C~20260327162323.0000000\"",
            "Product": "15/872/30/3334",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623230000000C~20260327162323.0000000\"",
                    "Product": "15/872/30/3334",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 872/3  L.COLLECTION L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623230000000C~20260327162323.0000000\"",
                    "Product": "15/872/30/3334",
                    "Language": "EN",
                    "ProductDescription": "لوزه 3/872 L.COLLECTION L"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701190000000C~20260326170119.0000000\"",
            "Product": "15/872/30/5551",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701190000000C~20260326170119.0000000\"",
                    "Product": "15/872/30/5551",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 872 / 3 INCH RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701190000000C~20260326170119.0000000\"",
                    "Product": "15/872/30/5551",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623230000000C~20260327162323.0000000\"",
            "Product": "15/872/30/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623230000000C~20260327162323.0000000\"",
                    "Product": "15/872/30/5554",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 872/3 Inch Rainbow L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623230000000C~20260327162323.0000000\"",
                    "Product": "15/872/30/5554",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623230000000C~20260327162323.0000000\"",
            "Product": "15/872/30/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623230000000C~20260327162323.0000000\"",
                    "Product": "15/872/30/6",
                    "Language": "AR",
                    "ProductDescription": "Pearshape 872/ 3 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623230000000C~20260327162323.0000000\"",
                    "Product": "15/872/30/6",
                    "Language": "EN",
                    "ProductDescription": "لوزه 3/872 بوصة درجة موحدة"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701190000000C~20260326170119.0000000\"",
            "Product": "15/872/30/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701190000000C~20260326170119.0000000\"",
                    "Product": "15/872/30/64",
                    "Language": "AR",
                    "ProductDescription": "Pearshape 872/3 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701190000000C~20260326170119.0000000\"",
                    "Product": "15/872/30/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701180000000C~20260326170118.0000000\"",
            "Product": "15/872/35/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701180000000C~20260326170118.0000000\"",
                    "Product": "15/872/35/5554",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 872/3.5 INCH  L RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701180000000C~20260326170118.0000000\"",
                    "Product": "15/872/35/5554",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623230000000C~20260327162323.0000000\"",
            "Product": "15/872/35/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623230000000C~20260327162323.0000000\"",
                    "Product": "15/872/35/64",
                    "Language": "AR",
                    "ProductDescription": "Pearshape 872/3.5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623230000000C~20260327162323.0000000\"",
                    "Product": "15/872/35/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623230000000C~20260327162323.0000000\"",
            "Product": "15/872/40/3334",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623230000000C~20260327162323.0000000\"",
                    "Product": "15/872/40/3334",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 872/4 INCH L.COLLECTION L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623230000000C~20260327162323.0000000\"",
                    "Product": "15/872/40/3334",
                    "Language": "EN",
                    "ProductDescription": "لوزه 4/872 L.COLLECTION L"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701180000000C~20260326170118.0000000\"",
            "Product": "15/872/40/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701180000000C~20260326170118.0000000\"",
                    "Product": "15/872/40/5554",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 872/4 INCH  RAINBOW  L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701180000000C~20260326170118.0000000\"",
                    "Product": "15/872/40/5554",
                    "Language": "EN",
                    "ProductDescription": "لوزه 4/872 Lبوصة درجة RAINBOW"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701180000000C~20260326170118.0000000\"",
            "Product": "15/872/40/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701180000000C~20260326170118.0000000\"",
                    "Product": "15/872/40/64",
                    "Language": "AR",
                    "ProductDescription": "Pearshape 872/4 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701180000000C~20260326170118.0000000\"",
                    "Product": "15/872/40/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623220000000C~20260327162322.0000000\"",
            "Product": "15/872/50/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623220000000C~20260327162322.0000000\"",
                    "Product": "15/872/50/5554",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 872 / 5 INCH ( Rainbow ) L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623220000000C~20260327162322.0000000\"",
                    "Product": "15/872/50/5554",
                    "Language": "EN",
                    "ProductDescription": "لوزه 5/872 Lبوصة درجة RAIN"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701170000000C~20260326170117.0000000\"",
            "Product": "15/872/50/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701170000000C~20260326170117.0000000\"",
                    "Product": "15/872/50/64",
                    "Language": "AR",
                    "ProductDescription": "Pearshape 872/5 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701170000000C~20260326170117.0000000\"",
                    "Product": "15/872/50/64",
                    "Language": "EN",
                    "ProductDescription": "لوزة 5/872 بوصة موحدة باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701170000000C~20260326170117.0000000\"",
            "Product": "15/873/15/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701170000000C~20260326170117.0000000\"",
                    "Product": "15/873/15/555",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 873 / 1.5 INCH RAINBOW"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701170000000C~20260326170117.0000000\"",
                    "Product": "15/873/15/555",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623220000000C~20260327162322.0000000\"",
            "Product": "15/873/15/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623220000000C~20260327162322.0000000\"",
                    "Product": "15/873/15/6",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAP 873/1.5 Inch Almazza"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623220000000C~20260327162322.0000000\"",
                    "Product": "15/873/15/6",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701170000000C~20260326170117.0000000\"",
            "Product": "15/873/2/6",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701170000000C~20260326170117.0000000\"",
                    "Product": "15/873/2/6",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 873 / 2 INCH (ALMAZZA )"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701170000000C~20260326170117.0000000\"",
                    "Product": "15/873/2/6",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623220000000C~20260327162322.0000000\"",
            "Product": "15/873/20/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623220000000C~20260327162322.0000000\"",
                    "Product": "15/873/20/333",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 873 / 2 INCH L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623220000000C~20260327162322.0000000\"",
                    "Product": "15/873/20/333",
                    "Language": "EN",
                    "ProductDescription": "لوزه 2/873 بوصه L.Collection"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623220000000C~20260327162322.0000000\"",
            "Product": "15/873/20/3334",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623220000000C~20260327162322.0000000\"",
                    "Product": "15/873/20/3334",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 873 / 2 INCH L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623220000000C~20260327162322.0000000\"",
                    "Product": "15/873/20/3334",
                    "Language": "EN",
                    "ProductDescription": "لوزه 2/873 L.COLLECTION L"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623210000000C~20260327162321.0000000\"",
            "Product": "15/873/20/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623210000000C~20260327162321.0000000\"",
                    "Product": "15/873/20/5554",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 873 / 2 INCH RAINBOW L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623210000000C~20260327162321.0000000\"",
                    "Product": "15/873/20/5554",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701160000000C~20260326170116.0000000\"",
            "Product": "15/873/20/64",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701160000000C~20260326170116.0000000\"",
                    "Product": "15/873/20/64",
                    "Language": "AR",
                    "ProductDescription": "Pearshape 873/2 Inch Almazza L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701160000000C~20260326170116.0000000\"",
                    "Product": "15/873/20/64",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623210000000C~20260327162321.0000000\"",
            "Product": "15/873/25/333",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623210000000C~20260327162321.0000000\"",
                    "Product": "15/873/25/333",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 873 / 2.5 inch L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623210000000C~20260327162321.0000000\"",
                    "Product": "15/873/25/333",
                    "Language": "EN",
                    "ProductDescription": "لوزه 2.5/873 بوصه L.Collection"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623210000000C~20260327162321.0000000\"",
            "Product": "15/873/25/33334",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623210000000C~20260327162321.0000000\"",
                    "Product": "15/873/25/33334",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 873 / 2.5 inch L.Collection"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623210000000C~20260327162321.0000000\"",
                    "Product": "15/873/25/33334",
                    "Language": "EN",
                    "ProductDescription": "لوزة 873/2.5 بوصة درجة L.CO باللوجو"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623210000000C~20260327162321.0000000\"",
            "Product": "15/873/25/3334",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623210000000C~20260327162321.0000000\"",
                    "Product": "15/873/25/3334",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 873/2.5  L.COLLECTION L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623210000000C~20260327162321.0000000\"",
                    "Product": "15/873/25/3334",
                    "Language": "EN",
                    "ProductDescription": "لوزه 2.5/873 L.COLLECTION L"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603261701150000000C~20260326170115.0000000\"",
            "Product": "15/873/25/555",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603261701150000000C~20260326170115.0000000\"",
                    "Product": "15/873/25/555",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE 873 / 2.5 INCH Rainbow"
                },
                {
                    "@odata.etag": "W/\"SADL-202603261701150000000C~20260326170115.0000000\"",
                    "Product": "15/873/25/555",
                    "Language": "EN",
                    "ProductDescription": "لوزة 2.5 /873  Rainbow"
                }
            ]
        },
        {
            "@odata.etag": "W/\"SADL-202603271623210000000C~20260327162321.0000000\"",
            "Product": "15/873/25/5554",
            "BaseUnit": "EA",
            "_ProductDescription": [
                {
                    "@odata.etag": "W/\"SADL-202603271623210000000C~20260327162321.0000000\"",
                    "Product": "15/873/25/5554",
                    "Language": "AR",
                    "ProductDescription": "PEARSHAPE  873/2.5  Inch RAINBOW L"
                },
                {
                    "@odata.etag": "W/\"SADL-202603271623210000000C~20260327162321.0000000\"",
                    "Product": "15/873/25/5554",
                    "Language": "EN",
                    "ProductDescription": "دبوس 3/504 درجه RAINBOW بالوجو"
                }
            ]
        },
    ]
}
