using {db} from '../db/scheme.cds';

service PriceReplicationService {
    entity ScheduledPrices as projection on db.ScheduledPrice;

    type PriceSyncData {
        @mandatory sku       : String;
        currency : String;
        @mandatory price    : Decimal;
        @mandatory validFrom: Date;
    };

    action SyncPrice(data: many PriceSyncData) returns {
        message : String;
    };
}
