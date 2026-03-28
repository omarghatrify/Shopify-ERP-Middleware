import '@shopify/shopify-api/adapters/node';
import {restResources} from '@shopify/shopify-api/rest/admin/2026-01';
import { shopifyApi, ApiVersion } from '@shopify/shopify-api';
export default shopifyApi({
    apiKey: process.env.SHOPIFY_API_KEY!,
    apiSecretKey: process.env.SHOPIFY_API_SECRET_KEY!,
    hostName: process.env.SHOPIFY_HOST_NAME!,
    apiVersion: ApiVersion.January26,
    isEmbeddedApp: false,
    restResources
});

// export default shopifyApi({
//     apiSecretKey: process.env.SHOPIFY_API_SECRET_KEY!,            // Note: this is the API Secret Key, NOT the API access token
//     apiVersion: ApiVersion.January26,
//     isCustomStoreApp: true,                        // this MUST be set to true (default is false)
//     adminApiAccessToken: process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN!, // Note: this is the API access token, NOT the API Secret Key
//     isEmbeddedApp: false,
//     hostName: process.env.SHOPIFY_HOST_NAME!,
// });
