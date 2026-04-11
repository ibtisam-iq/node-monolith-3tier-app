const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

// Note: file-loader and url-loader are deprecated since Webpack 5.
// Webpack 5 handles images and assets natively via Asset Modules.
// - type: 'asset/resource'  → emits a separate file (replaces file-loader)
// - type: 'asset/inline'    → inlines as base64 data URL (replaces url-loader)
// - type: 'asset'           → auto-chooses based on size limit (replaces url-loader with limit option)

module.exports = {
  mode: 'production',
  entry: './src/index.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,  // clears dist/ before each build
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/index.html',  // use our template
      filename: 'index.html',        // output as dist/index.html
    }),
  ],
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        // Replaces url-loader with limit option.
        // Files < 8192 bytes are inlined as base64; larger files are emitted as separate files.
        test: /\.(png|jpe?g|gif|svg)$/i,
        type: 'asset',
        parser: {
          dataUrlCondition: {
            maxSize: 8192, // 8 KB — same threshold as the old url-loader limit
          },
        },
      },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: 'babel-loader',
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.css', '.png'],
  },
};
