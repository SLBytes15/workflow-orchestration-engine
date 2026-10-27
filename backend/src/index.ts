import "dotenv/config";
import app from "./app";
import { connectDatabase } from "./config/database";
import { createChangeStreamWatcherService } from "./services/changeStreamWatcher.service";

export interface ServerLike {
  close(callback?: (err?: Error) => void): unknown;
  on(event: string, listener: (...args: any[]) => unknown): unknown;
  listening?: boolean;
}

export interface WatcherServiceLike {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

export interface ServerStartupDependencies {
  port: number;
  connectDatabase: () => Promise<void>;
  listen: (port: number, hostname: string, callback?: () => void) => ServerLike;
  createWatcher: () => WatcherServiceLike;
  logger: {
    log: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
  setExitCode: (code: number) => void;
  registerSignalHandlers: boolean;
}

export interface ServerStartupResult {
  status: "running";
  server: ServerLike;
  watcher: WatcherServiceLike;
  shutdown: (signal?: string) => Promise<void>;
}

export const defaultDependencies: ServerStartupDependencies = {
  port: Number(process.env.PORT) || 3000,
  connectDatabase: () => connectDatabase(),
  listen: (port, hostname, callback) => app.listen(port, hostname, callback),
  createWatcher: () => createChangeStreamWatcherService(),
  logger: {
    log: (msg: string, ...args: unknown[]) => console.log(msg, ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn(msg, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(msg, ...args),
  },
  setExitCode: (code: number) => {
    process.exitCode = code;
  },
  registerSignalHandlers: true,
};

export async function startServer(
  dependencies: Partial<ServerStartupDependencies> = {},
): Promise<ServerStartupResult> {
  const mergedDeps: ServerStartupDependencies = {
    ...defaultDependencies,
    ...dependencies,
  };
  const { logger, setExitCode } = mergedDeps;
  const port =
    dependencies.port ??
    (Number(process.env.PORT) || defaultDependencies.port);

  let server: ServerLike | null = null;
  let watcher: WatcherServiceLike | null = null;
  let isShuttingDown = false;
  let sigTermHandler: (() => void) | null = null;
  let sigIntHandler: (() => void) | null = null;

  async function gracefulShutdown(signal: string = "MANUAL"): Promise<void> {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    logger.log(`[SHUTDOWN] Received ${signal}. Stopping services gracefully...`);

    if (sigTermHandler) {
      process.removeListener("SIGTERM", sigTermHandler);
      sigTermHandler = null;
    }
    if (sigIntHandler) {
      process.removeListener("SIGINT", sigIntHandler);
      sigIntHandler = null;
    }

    if (watcher) {
      try {
        await watcher.stop();
        logger.log("[SHUTDOWN] Change stream watcher stopped");
      } catch (watcherError) {
        logger.error(
          "[SHUTDOWN] Error stopping change stream watcher:",
          watcherError instanceof Error ? watcherError.message : watcherError,
        );
      }
      watcher = null;
    }

    if (server) {
      await new Promise<void>((resolve) => {
        server!.close((serverError) => {
          if (serverError) {
            logger.error("[SHUTDOWN] Error closing HTTP server:", serverError);
            setExitCode(1);
          } else {
            logger.log("[SHUTDOWN] HTTP server closed");
          }
          resolve();
        });
      });
      server = null;
    }
  }

  // 1. Connect to database
  try {
    await mergedDeps.connectDatabase();
  } catch (error) {
    logger.error(
      "[STARTUP] Server startup failed because MongoDB is unavailable.",
    );
    logger.error(
      error instanceof Error ? error.message : "Unknown startup error",
    );
    setExitCode(1);
    throw error;
  }

  // 2. Start HTTP server
  server = mergedDeps.listen(port, "localhost", () => {
    logger.log(`[STARTUP] Server listening at http://localhost:${port}`);
  });

  server.on("error", (error) => {
    logger.error("[SERVER ERROR]", error);
    setExitCode(1);
  });

  // 3. Start change stream watcher only after DB connection succeeds
  try {
    watcher = mergedDeps.createWatcher();
    await watcher.start();
    logger.log("[STARTUP] Change stream watcher started successfully");
  } catch (watcherError) {
    logger.error(
      "[STARTUP] Change stream watcher startup failed:",
      watcherError instanceof Error
        ? watcherError.message
        : "Unknown watcher error",
    );

    // Clean up partially initialized resources
    if (watcher) {
      try {
        await watcher.stop();
      } catch (stopErr) {
        logger.error(
          "[STARTUP] Error stopping watcher during cleanup:",
          stopErr instanceof Error ? stopErr.message : stopErr,
        );
      }
      watcher = null;
    }

    if (server) {
      await new Promise<void>((resolve) => {
        server!.close((serverErr) => {
          if (serverErr) {
            logger.error(
              "[STARTUP] Error closing HTTP server during cleanup:",
              serverErr,
            );
          } else {
            logger.log(
              "[STARTUP] Closed HTTP server following watcher startup failure",
            );
          }
          resolve();
        });
      });
      server = null;
    }

    setExitCode(1);
    throw watcherError;
  }

  // 4. Register signal handlers if enabled
  if (mergedDeps.registerSignalHandlers) {
    sigTermHandler = () => void gracefulShutdown("SIGTERM");
    sigIntHandler = () => void gracefulShutdown("SIGINT");
    process.on("SIGTERM", sigTermHandler);
    process.on("SIGINT", sigIntHandler);
  }

  return {
    status: "running",
    server,
    watcher,
    shutdown: gracefulShutdown,
  };
}

if (typeof require !== "undefined" && require.main === module) {
  void startServer().catch((error) => {
    console.error(
      "[STARTUP] Fatal error during startup:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  });
}
