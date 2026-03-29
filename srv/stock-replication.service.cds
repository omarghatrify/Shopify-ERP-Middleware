using {db} from '../db/scheme.cds';

service StockReplicationService {
    entity Inventory as projection on db.Inventory;

    type StockSyncData {
        @mandatory sku   : String;
        @mandatory qty : Decimal;
    };

    action SyncStock(data: many StockSyncData) returns {
        message : String;
    };
}
