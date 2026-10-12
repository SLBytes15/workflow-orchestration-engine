import "dotenv/config";
import app from "./app";
import { connectDatabase } from "./config/database";

const PORT = Number(process.env.PORT) || 3000;

async function startServer(): Promise<void> {
  try {
    await connectDatabase();

const server = app.listen(PORT, "localhost", () => {
  console.log(`[STARTUP] Server listening at http://localhost:${PORT}`);
});


    server.on("error", (error) => {
      console.error("[SERVER ERROR]", error);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(
      "[STARTUP] Server startup failed because MongoDB is unavailable.",
    );
    console.error(
      error instanceof Error ? error.message : "Unknown startup error",
    );
    process.exitCode = 1;
  }
}

void startServer();
