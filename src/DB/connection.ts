import mongoose from "mongoose";

const connectDB = async (): Promise<void> => {
  const mongoURI = process.env.MONGO_URI;

  if (!mongoURI) {
    throw new Error(
      "MONGO_URI is not defined in environment variables",
    );
  }

  const conn = await mongoose.connect(mongoURI, {
    serverSelectionTimeoutMS: 5000,
  });

  console.log(`MongoDB Connected: ${conn.connection.host}`);
};

export default connectDB;