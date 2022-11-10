module.exports = {
    "env": {
        node: true,
    },
    "extends": [
        "eslint:recommended",
        "plugin:vue/essential",
    ],
    "parserOptions": {
        parser: "babel-eslint",
    },
    "plugins": [
        "vue"
    ],
    "rules": {
      "no-console": process.env.NODE_ENV === "production" ? "warn" : "off",
      "no-debugger": process.env.NODE_ENV === "production" ? "warn" : "off",
    }
};
