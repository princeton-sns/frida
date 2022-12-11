const path = require("path");
const copy = require("copy-webpack-plugin");

module.exports = {
  chainWebpack: config => {
    config.plugin("copy")
     .use(copy)
     .tap(args => {
       if (args.length < 1) {
         args = [{ patterns: [] }];
       }
       args[0].patterns.push({
         from: path.resolve(__dirname, "node_modules", "@matrix-org", "olm", "olm.wasm"),
         to: path.resolve(__dirname, "dist"),
         toType: "dir",
       });
       return args;
    })
  }
}
