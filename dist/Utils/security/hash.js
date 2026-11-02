"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareHash = exports.generateHash = void 0;
const bcrypt_1 = require("bcrypt");
const generateHash = async (plaintext, saltRounds = Number(process.env.SALT_ROUNDS)) => {
    return await (0, bcrypt_1.hash)(plaintext, saltRounds);
};
exports.generateHash = generateHash;
const compareHash = async (plaintext, hashedText) => {
    return await (0, bcrypt_1.compare)(plaintext, hashedText);
};
exports.compareHash = compareHash;
