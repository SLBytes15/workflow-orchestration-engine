import mongoose from "mongoose";

export async function connectDatabase(
  uri: string | undefined = process.env.MONGODB_URI,
): Promise<void> {
  if (!uri?.trim()) {
    throw new Error("MONGODB_URI is not configured");
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });

    console.log("[DATABASE] MongoDB connected successfully");
  } catch (error) {
    console.error("[DATABASE] MongoDB connection failed");
    throw error;
  }
}
