const path = require("path");

module.exports = (env, argv) => {
  const isDevelopment = argv.mode === "development";

  return {
    mode: argv.mode || "production",

    context: __dirname,

    entry: "./src/index.ts",

    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "extension.js",
      library: {
        type: "commonjs2",
      },
      devtoolModuleFilenameTemplate: "[absolute-resource-path]",
    },

    devtool: isDevelopment ? "eval-source-map" : "source-map",

    // Externals - provided by Foxglove at runtime
    externals: {
      react: "commonjs react",
      "react-dom": "commonjs react-dom",
      "@foxglove/extension": "commonjs @foxglove/extension",
    },

    resolve: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
      fallback: {
        path: false,
        fs: false,
        http: false,
        https: false,
        url: false,
        buffer: false,
        stream: false,
        crypto: false,
        zlib: false,
        assert: false,
      },
    },

    module: {
      rules: [
        // TypeScript - always transpileOnly for speed
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: {
            loader: "ts-loader",
            options: {
              transpileOnly: true,
              compilerOptions: {
                sourceMap: true,
              },
            },
          },
        },

        // CSS
        {
          test: /\.css$/,
          use: ["style-loader", "css-loader"],
        },

        // Images and other assets
        {
          test: /\.(png|gif|jpg|jpeg|svg|xml)$/,
          type: "asset/resource",
        },
      ],
    },

    plugins: [],

    // Performance - Three.js + 3d-tiles-renderer bundle will be large
    performance: {
      hints: false,
      maxEntrypointSize: 10000000,
      maxAssetSize: 10000000,
    },

    // Optimization
    optimization: {
      minimize: !isDevelopment,
      splitChunks: false,
    },

    stats: {
      errorDetails: true,
      warnings: true,
    },
  };
};
