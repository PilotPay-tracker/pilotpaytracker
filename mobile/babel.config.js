/* global __dirname */
const path = require("path");

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind", unstable_transformImportMeta: true }],
      "nativewind/babel",
    ],
    plugins: [
      [
        "module-resolver",
        {
          root: ["."],
          alias: {
            "@": "./src",
            "better-auth/react": "./node_modules/better-auth/dist/client/react/index.mjs",
            "better-auth/client/plugins":
              "./node_modules/better-auth/dist/client/plugins/index.mjs",
            "@better-auth/expo/client": "./node_modules/@better-auth/expo/dist/client.mjs",
          },
        },
      ],
      "@babel/plugin-proposal-export-namespace-from",
      "react-native-reanimated/plugin",
    ],
  };
};
