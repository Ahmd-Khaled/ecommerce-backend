"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateOTP = void 0;
const node_crypto_1 = require("node:crypto");
const generateOTP = () => {
    return (0, node_crypto_1.randomInt)(0, 1_000_000)
        .toString()
        .padStart(6, "0");
};
exports.generateOTP = generateOTP;
