"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenModel = exports.TokenSchema = void 0;
const mongoose_1 = require("mongoose");
exports.TokenSchema = new mongoose_1.Schema({
    jti: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    expiresAt: {
        type: Date,
        required: true,
        expires: 0,
    },
    userId: {
        type: mongoose_1.Schema.Types.ObjectId,
        required: true,
        ref: "User",
        index: true,
    },
}, {
    timestamps: true,
});
exports.TokenModel = mongoose_1.models.Token ??
    (0, mongoose_1.model)("Token", exports.TokenSchema);
