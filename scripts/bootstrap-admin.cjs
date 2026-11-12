// Explicit operator command; never runs as part of application startup.
require("dotenv").config({ path: "./config/.env.dev" });
const mongoose = require("mongoose");
const { AdminModel } = require("../dist/DB/models/admin/admin.model");
const { createAdminSchema } = require("../dist/Modules/admin/admin.validation");
async function main() {
  const data = createAdminSchema.parse({
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    firstName: process.env.BOOTSTRAP_ADMIN_FIRST_NAME,
    lastName: process.env.BOOTSTRAP_ADMIN_LAST_NAME,
    role: "super-admin",
  });
  // console.log("Creating super-admin...", data);
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI);
  await AdminModel.init();
  if (await AdminModel.exists({ role: "super-admin", deletedAt: null }))
    throw new Error("A super-admin already exists");
  // A fixed ID also prevents two simultaneous bootstrap commands from succeeding.
  await AdminModel.create({
    ...data,
    _id: new mongoose.Types.ObjectId("000000000000000000000001"),
  });
  console.log(
    "Super-admin created. Remove BOOTSTRAP_ADMIN_PASSWORD from the environment.",
  );
}
main()
  .catch((error) => {
    console.error(
      error.code === 11000
        ? "Bootstrap already completed or email exists"
        : "Bootstrap failed: " + error.message,
    );
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
