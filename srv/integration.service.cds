using {db} from '../db/scheme.cds';
using {OP_PRODUCT_0002} from './external/OP_PRODUCT_0002';

service IntegrationService {
    entity Products as projection on db.Product;

    action SyncProducts(correlationId: String,
                        @mandatory materials: many ProductMappingSyncData,
                        @mandatory overwrite: Boolean) returns {
        correlationId : String;
        status        : many {
            material : String;
            status   : String enum {
                PENDING;
                CREATED;
                UPDATED;
                EXISTING;
                ERROR;
            };
        }
    };


    type StockSyncData {
        @mandatory sku   : String;
        @mandatory qty : Decimal;

    };

    action SyncStock(data: many StockSyncData)         returns {
        message : String;
    };

    type ProductMappingSyncData {
        @mandatory sku  : String;
        @mandatory uom  : String;
        @mandatory name : many {
            @mandatory val  : String;
            @mandatory lang : String;
        }
        @mandatory desc : many {
            @mandatory val  : String;
            @mandatory lang : String;
        }
    };


    entity Inventory as projection on db.Inventory;
};
