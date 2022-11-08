const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const WasmPackPlugin = require("@wasm-tool/wasm-pack-plugin");

const dist = path.resolve(__dirname, "public");

module.exports = {
    mode: "production",
    entry: {
	index: "./js/index.js"
    },
    module: {
	rules: [
	    {
		test: /\.(js)$/,
		include: path.resolve(__dirname, "node_modules", "d3-dag", "bundle"),
		use: ['babel-loader']
	    },
	    {
		test: /\.(wasm)$/,
		type: "webassembly/async"
	    }
	],
    },
    resolve: {
	extensions: ['*', '.js']
    },
    output: {
	path: dist,
	filename: "[name].js"
    },
    // devServer: {
    // 	contentBase: dist,
    // },
    plugins: [
	new CopyPlugin([
	    path.resolve(__dirname, "static")
	]),

	new CopyPlugin([
	    path.resolve(__dirname, "node_modules", "d3-dag", "bundle")
	]),

	new WasmPackPlugin({
	    crateDirectory: __dirname,
	}),
    ],
    experiments: {
	asyncWebAssembly: true,
    },
    performance: {
	hints: false,
	maxEntrypointSize: 512000,
	maxAssetSize: 512000
    },
};
