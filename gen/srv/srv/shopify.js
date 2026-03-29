"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("@shopify/shopify-api/adapters/node");
const _2026_01_1 = require("@shopify/shopify-api/rest/admin/2026-01");
const shopify_api_1 = require("@shopify/shopify-api");
exports.default = (0, shopify_api_1.shopifyApi)({
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET_KEY,
    hostName: process.env.SHOPIFY_HOST_NAME,
    apiVersion: shopify_api_1.ApiVersion.January26,
    isEmbeddedApp: false,
    restResources: _2026_01_1.restResources
});
// export default shopifyApi({
//     apiSecretKey: process.env.SHOPIFY_API_SECRET_KEY!,            // Note: this is the API Secret Key, NOT the API access token
//     apiVersion: ApiVersion.January26,
//     isCustomStoreApp: true,                        // this MUST be set to true (default is false)
//     adminApiAccessToken: process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN!, // Note: this is the API access token, NOT the API Secret Key
//     isEmbeddedApp: false,
//     hostName: process.env.SHOPIFY_HOST_NAME!,
// });
//# sourceMappingURL=shopify.js.map