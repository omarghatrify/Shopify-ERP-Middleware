using {db} from '../db/scheme.cds';

service ProductReplicationService {
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

    /** Accepts OData-style product payload (e.g. API_PRODUCT `value` array); maps and runs SyncProducts. */
    @open
    action LoadProducts(correlationId: String, overwrite: Boolean, @mandatory value: many {
        Product             : String;
        BaseUnit            : String;
        _ProductDescription : many {
            Language           : String;
            ProductDescription : String;
            Product            : String;
        };
    })

    type ProductMappingSyncData {
        @mandatory sku  : String;
        @mandatory uom  : String;
        @mandatory name : many {
            @mandatory val  : String;
            @mandatory lang : String;
        }
        desc : many {
            @mandatory val  : String;
            @mandatory lang : String;
        }
    }
}


annotate ProductReplicationService with @cds.server.body_parser.limit: '20mb';