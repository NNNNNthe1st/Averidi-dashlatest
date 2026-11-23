import type { NextConfig } from "next";
import {dashboardMaxUploadBodyBytes} from './src/engines/ingestion/limits';

// Serve independently under the canonical www.averidi.com/dashboard/app path.
// Website routing/proxy must be separately approved; do not modify it here.
const config: NextConfig = {
  basePath: "/dashboard/app",
  poweredByHeader: false,
  // Native spreadsheet parsing keeps optional ZIP-provider adapters out of bundling.
  serverExternalPackages: ["@duckdb/node-api","@duckdb/node-bindings","exceljs-hardened","pdfkit","svg-to-pdfkit","@resvg/resvg-js","sharp"],
  // Clean acceptance builds intentionally discard persistent compiler output.
  experimental:{proxyClientMaxBodySize:dashboardMaxUploadBodyBytes(),
    ...(process.env.DASHBOARD_VERIFICATION_NO_BUILD_CACHE==='true'?{turbopackFileSystemCacheForBuild:false}:{})},
  // Permit only this development Codespace's exact forwarded app hostname.
  ...(process.env.NODE_ENV!=="production"&&process.env.CODESPACES==="true"&&
    /^[a-z0-9][a-z0-9-]{6,98}[a-z0-9]$/.test(process.env.CODESPACE_NAME??"")&&
    process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN==="app.github.dev"
    ?{allowedDevOrigins:[`${process.env.CODESPACE_NAME}-3000.app.github.dev`]}:{}),
};
export default config;
