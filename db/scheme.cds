using {managed} from '@sap/cds/common';


namespace db;

@plural: 'Products'
entity Product {
    key sap_material         : String not null;

        @unique: 'shopify_variant_id'
        shopify_variant_id   : String;

        @unique: 'shopify_product_id'
        shopify_product_id   : String;

        @unique: 'shopify_inventory_id'
        shopify_inventory_id : String;
        created_at           : Timestamp  @cds.on.insert: $now;
        modified_at          : Timestamp  @cds.on.insert: $now  @cds.on.update: $now;
        uom                  : String;
        name                 : many {
            @mandatory val  : String;
            @mandatory lang : String;
        };
        desc                 : many {
            @mandatory val  : String;
            @mandatory lang : String;
        };

        Inventory            : Composition of many Inventory
                                   on Inventory.Product = $self;
};


// Stock Replication Entity
entity Inventory {
    key sku                  : String;
    key locationId           : String;

        quantity             : Decimal;
        last_updated_at      : Timestamp;
        last_replicated_at   : Timestamp;

        needs_replication    : Boolean default true;

        replication_attempts : Integer default 0;
        last_error           : String;

        Product              : Association to Product
                                   on Product.sap_material = $self.sku;
}
