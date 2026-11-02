"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoleEnum = exports.GenderEnum = void 0;
var GenderEnum;
(function (GenderEnum) {
    GenderEnum["MALE"] = "male";
    GenderEnum["FEMALE"] = "female";
})(GenderEnum || (exports.GenderEnum = GenderEnum = {}));
var RoleEnum;
(function (RoleEnum) {
    RoleEnum["USER"] = "user";
    RoleEnum["ADMIN"] = "admin";
    RoleEnum["GUEST"] = "guest";
})(RoleEnum || (exports.RoleEnum = RoleEnum = {}));
