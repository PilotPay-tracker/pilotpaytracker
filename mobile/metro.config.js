// metro.config.js
// NOTE TO AI: Do note change this file unless you are 110% sure you know what you are doing. It will likely break the app.

const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const { withVibecodeMetro } = require("@vibecodeapp/sdk/metro");
const path = require("path");
const fs = require("fs");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Only configure shared folder if it exists (may not exist during Docker build)
const sharedFolder = path.resolve(__dirname, "../shared");
const sharedFolderExists = fs.existsSync(sharedFolder);

// DEBUG: Log metro.config.js version and shared folder status at startup
console.log("[Metro Config] Version: 2025-02-03-v3-fix-dynamic-imports (source: workspace-mobile)");
console.log(`[Metro Config] Shared folder: ${sharedFolder}`);
console.log(`[Metro Config] Shared folder exists: ${sharedFolderExists}`);

if (sharedFolderExists) {
  config.watchFolders = [sharedFolder];
}

// Disable Watchman for file watching.
config.resolver.useWatchman = false;

// Configure asset and source extensions.
const { assetExts, sourceExts } = config.resolver;

// SVG transformer is configured by withVibecodeMetro
config.transformer = {
  ...config.transformer,
  getTransformOptions: async () => ({
    transform: {
      experimentalImportSupport: false,
      inlineRequires: true,
    },
  }),
};

// Helper: check if a .js counterpart exists for a .mjs path
function mjsToJs(mjsPath) {
  const jsPath = mjsPath.replace(/\.mjs$/, ".js");
  try {
    if (fs.existsSync(jsPath)) return jsPath;
  } catch (_) {}
  return null;
}

// Configure resolver with SVG support, shared folder resolution, and web platform mocking
config.resolver = {
  ...config.resolver,
  assetExts: assetExts.filter((ext) => ext !== "svg"),
  sourceExts: [...sourceExts, "svg", "mjs"],
  useWatchman: false,
  // Only add shared folder resolution if it exists
  // NOTE: unstable_enablePackageExports moved inside conditional - it breaks dynamic imports
  // like `await import("expo-image")` when enabled globally
  ...(sharedFolderExists && {
    unstable_enablePackageExports: true,
    extraNodeModules: {
      ...config.resolver.extraNodeModules,
      "@/shared": sharedFolder,
    },
    nodeModulesPaths: [
      path.resolve(__dirname, "node_modules"),
      path.resolve(__dirname, "../backend/node_modules"),
    ],
  }),
  // Override package exports for packages that ship broken ESM-only exports
  // that Metro cannot handle. Maps package name -> exports field override.
  unstable_conditionNames: ["require", "default"],
  resolveRequest: (context, moduleName, platform) => {
    // Handle @/shared/* imports explicitly
    // This is needed because:
    // 1. extraNodeModules alone doesn't handle subpath resolution
    // 2. Babel alias would transform to relative path which fails for nested files
    if (sharedFolderExists && moduleName.startsWith("@/shared/")) {
      const subpath = moduleName.slice("@/shared/".length);
      const resolvedPath = path.join(sharedFolder, subpath);
      console.log(`[Metro Resolve] @/shared alias: ${moduleName} -> ${resolvedPath}`);
      return context.resolveRequest(context, resolvedPath, platform);
    }

    // Also handle exact @/shared import (without subpath)
    if (sharedFolderExists && moduleName === "@/shared") {
      console.log(`[Metro Resolve] @/shared exact: ${moduleName} -> ${sharedFolder}`);
      return context.resolveRequest(context, sharedFolder, platform);
    }

    // Handle relative ../shared/* imports (fallback for unmigrated legacy code)
    // These imports are incorrect (resolve to wrong location) but we redirect them
    // to the actual shared folder for backwards compatibility
    // IMPORTANT: Only apply to user code, NOT node_modules (e.g., better-auth has its own internal shared/)
    if (sharedFolderExists && !context.originModulePath?.includes("node_modules")) {
      const relativeSharedMatch = moduleName.match(/^(?:\.\.\/)+shared\/(.+)$/);
      if (relativeSharedMatch) {
        const subpath = relativeSharedMatch[1];
        const resolvedPath = path.join(sharedFolder, subpath);
        console.log(`[Metro Resolve] RELATIVE SHARED: ${moduleName} -> ${resolvedPath}`);
        return context.resolveRequest(context, resolvedPath, platform);
      }
    }

    // Fix @better-auth/expo/client - package exports point to .mjs which Metro can't resolve.
    // Directly map to the .js file in dist/.
    if (moduleName === "@better-auth/expo/client") {
      const clientJs = path.resolve(
        __dirname,
        "node_modules/@better-auth/expo/dist/client.js"
      );
      console.log(`[Metro Resolve] @better-auth/expo/client -> ${clientJs}`);
      return {
        filePath: clientJs,
        type: "sourceFile",
      };
    }

    // Fix @better-auth/expo/* subpath exports that resolve to .mjs
    // Catch any subpath like @better-auth/expo/something
    if (moduleName.startsWith("@better-auth/expo/")) {
      const subpath = moduleName.slice("@better-auth/expo/".length);
      const jsPath = path.resolve(
        __dirname,
        `node_modules/@better-auth/expo/dist/${subpath}.js`
      );
      if (fs.existsSync(jsPath)) {
        console.log(`[Metro Resolve] ${moduleName} -> ${jsPath}`);
        return { filePath: jsPath, type: "sourceFile" };
      }
    }

    // Fix better-auth ESM resolution: Metro resolves to .cjs but package only ships .mjs
    // Intercept .cjs paths and redirect to .mjs
    if (moduleName.includes("better-auth") && moduleName.endsWith(".cjs")) {
      const mjsPath = moduleName.replace(/\.cjs$/, ".mjs");
      return context.resolveRequest(context, mjsPath, platform);
    }

    // Fix any .mjs file that Metro refuses to load - redirect to .js equivalent if it exists
    if (moduleName.endsWith(".mjs")) {
      const jsEquivalent = mjsToJs(moduleName);
      if (jsEquivalent) {
        console.log(`[Metro Resolve] .mjs -> .js: ${moduleName} -> ${jsEquivalent}`);
        return { filePath: jsEquivalent, type: "sourceFile" };
      }
    }

    // Fix @better-auth/expo incorrectly importing metro-config (dev-time only)
    // This import shouldn't exist in client code - mock it
    if (moduleName.includes("@expo/metro-config") || moduleName.includes("async-require")) {
      return { type: "empty" };
    }

    // Mock native-only modules on web
    if (platform === "web") {
      const nativeOnlyModules = [
        "react-native-pager-view",
        "reanimated-tab-view",
        "@bottom-tabs/react-navigation",
      ];

      if (nativeOnlyModules.some((mod) => moduleName.includes(mod))) {
        return {
          type: "empty",
        };
      }
    }

    // Fallback to default resolution
    return context.resolveRequest(context, moduleName, platform);
  },
};

// Integrate NativeWind with the Metro configuration.
module.exports = withNativeWind(withVibecodeMetro(config), { input: "./global.css" });