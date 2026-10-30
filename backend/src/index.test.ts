import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventEmitter } from "node:events";
import {
  startServer,
  type ServerLike,
  type WatcherServiceLike,
} from "./index";

class FakeServer extends EventEmitter implements ServerLike {
  public listening = true;
  public closeCalls = 0;
  public closeError: Error | null = null;

  close(callback?: (err?: Error) => void): this {
    this.closeCalls++;
    this.listening = false;
    if (callback) {
      callback(this.closeError ?? undefined);
    }
    return this;
  }
}

class FakeWatcher implements WatcherServiceLike {
  public running = false;
  public startCalls = 0;
  public stopCalls = 0;
  public startError: Error | null = null;
  public stopError: Error | null = null;
  public partiallyOpened = false;

  async start(): Promise<void> {
    this.startCalls++;
    if (this.startError) {
      this.partiallyOpened = true;
      throw this.startError;
    }
    this.running = true;
  }

  async stop(): Promise<void> {
    this.stopCalls++;
    this.running = false;
    this.partiallyOpened = false;
    if (this.stopError) {
      throw this.stopError;
    }
  }

  isRunning(): boolean {
    return this.running;
  }
}

function createTestLogger() {
  const logs: string[] = [];
  const errors: string[] = [];
  const warns: string[] = [];

  return {
    logs,
    errors,
    warns,
    logger: {
      log: (msg: string, ...args: unknown[]) =>
        logs.push([msg, ...args.map(String)].join(" ")),
      warn: (msg: string, ...args: unknown[]) =>
        warns.push([msg, ...args.map(String)].join(" ")),
      error: (msg: string, ...args: unknown[]) =>
        errors.push([msg, ...args.map(String)].join(" ")),
    },
  };
}

describe("Server Startup & Watcher Initialization", () => {
  it("follows the intended startup order (connectDatabase -> listen -> watcher.start)", async () => {
    const callOrder: string[] = [];
    const fakeServer = new FakeServer();
    const fakeWatcher = new FakeWatcher();
    let exitCode: number | null = null;
    const { logger } = createTestLogger();

    const result = await startServer({
      port: 8080,
      connectDatabase: async () => {
        callOrder.push("connectDatabase");
      },
      listen: (port, hostname, cb) => {
        callOrder.push("listen");
        if (cb) cb();
        return fakeServer;
      },
      createWatcher: () => {
        callOrder.push("createWatcher");
        return fakeWatcher;
      },
      logger,
      setExitCode: (code) => {
        exitCode = code;
      },
      registerSignalHandlers: false,
    });

    assert.equal(result.status, "running");
    assert.deepEqual(callOrder, [
      "connectDatabase",
      "listen",
      "createWatcher",
    ]);
    assert.equal(fakeWatcher.startCalls, 1);
    assert.equal(fakeWatcher.running, true);
    assert.equal(fakeServer.listening, true);
    assert.equal(exitCode, null);
  });

  it("fails startup and sets non-zero exit code if watcher startup fails", async () => {
    const fakeServer = new FakeServer();
    const fakeWatcher = new FakeWatcher();
    fakeWatcher.startError = new Error("MongoDB Change Stream unsupported on standalone");
    let exitCode: number | null = null;
    const { logger, errors } = createTestLogger();

    await assert.rejects(
      async () => {
        await startServer({
          port: 8080,
          connectDatabase: async () => {},
          listen: (_port, _hostname, cb) => {
            if (cb) cb();
            return fakeServer;
          },
          createWatcher: () => fakeWatcher,
          logger,
          setExitCode: (code) => {
            exitCode = code;
          },
          registerSignalHandlers: false,
        });
      },
      (err: Error) => {
        assert.match(err.message, /Change Stream unsupported/);
        return true;
      },
    );

    assert.equal(exitCode, 1);
    assert.ok(
      errors.some((e) =>
        e.includes("Change stream watcher startup failed: MongoDB Change Stream unsupported"),
      ),
      "Expected sanitized error message in logger",
    );
  });

  it("closes the HTTP server so it does not remain available after watcher startup failure", async () => {
    const fakeServer = new FakeServer();
    const fakeWatcher = new FakeWatcher();
    fakeWatcher.startError = new Error("ReplicaSetNoPrimary");
    let exitCode: number | null = null;
    const { logger, logs } = createTestLogger();

    assert.equal(fakeServer.listening, true);

    await assert.rejects(async () => {
      await startServer({
        port: 8080,
        connectDatabase: async () => {},
        listen: (_port, _hostname, cb) => {
          if (cb) cb();
          return fakeServer;
        },
        createWatcher: () => fakeWatcher,
        logger,
        setExitCode: (code) => {
          exitCode = code;
        },
        registerSignalHandlers: false,
      });
    });

    // Server must have been closed
    assert.equal(fakeServer.closeCalls, 1);
    assert.equal(fakeServer.listening, false);
    assert.equal(exitCode, 1);
    assert.ok(
      logs.some((l) =>
        l.includes("Closed HTTP server following watcher startup failure"),
      ),
    );
  });

  it("cleans up partially opened watcher resources on startup failure", async () => {
    const fakeServer = new FakeServer();
    const fakeWatcher = new FakeWatcher();
    fakeWatcher.startError = new Error("Stream connection timeout");
    let exitCode: number | null = null;
    const { logger } = createTestLogger();

    await assert.rejects(async () => {
      await startServer({
        port: 8080,
        connectDatabase: async () => {},
        listen: (_port, _hostname, cb) => {
          if (cb) cb();
          return fakeServer;
        },
        createWatcher: () => fakeWatcher,
        logger,
        setExitCode: (code) => {
          exitCode = code;
        },
        registerSignalHandlers: false,
      });
    });

    // Watcher stop must have been called to clean up partially opened resources
    assert.equal(fakeWatcher.stopCalls, 1);
    assert.equal(fakeWatcher.partiallyOpened, false);
    assert.equal(fakeServer.closeCalls, 1);
    assert.equal(exitCode, 1);
  });

  it("handles watcher stop error during failure cleanup without swallowing primary error", async () => {
    const fakeServer = new FakeServer();
    const fakeWatcher = new FakeWatcher();
    fakeWatcher.startError = new Error("Stream failed to initialize");
    fakeWatcher.stopError = new Error("Watcher stop error");
    let exitCode: number | null = null;
    const { logger, errors } = createTestLogger();

    await assert.rejects(
      async () => {
        await startServer({
          port: 8080,
          connectDatabase: async () => {},
          listen: (_port, _hostname, cb) => {
            if (cb) cb();
            return fakeServer;
          },
          createWatcher: () => fakeWatcher,
          logger,
          setExitCode: (code) => {
            exitCode = code;
          },
          registerSignalHandlers: false,
        });
      },
      (err: Error) => {
        assert.equal(err.message, "Stream failed to initialize");
        return true;
      },
    );

    assert.equal(fakeServer.closeCalls, 1);
    assert.equal(exitCode, 1);
    assert.ok(
      errors.some((e) =>
        e.includes("Error stopping watcher during cleanup: Watcher stop error"),
      ),
    );
  });

  it("fails immediately and sets exit code if database connection fails", async () => {
    let listenCalled = false;
    let watcherCreated = false;
    let exitCode: number | null = null;
    const { logger, errors } = createTestLogger();

    await assert.rejects(
      async () => {
        await startServer({
          port: 8080,
          connectDatabase: async () => {
            throw new Error("Mongoose connection timeout");
          },
          listen: () => {
            listenCalled = true;
            return new FakeServer();
          },
          createWatcher: () => {
            watcherCreated = true;
            return new FakeWatcher();
          },
          logger,
          setExitCode: (code) => {
            exitCode = code;
          },
          registerSignalHandlers: false,
        });
      },
      (err: Error) => {
        assert.equal(err.message, "Mongoose connection timeout");
        return true;
      },
    );

    assert.equal(listenCalled, false, "HTTP server should not be opened if DB fails");
    assert.equal(watcherCreated, false, "Watcher should not be created if DB fails");
    assert.equal(exitCode, 1);
    assert.ok(
      errors.some((e) =>
        e.includes("Server startup failed because MongoDB is unavailable."),
      ),
    );
  });

  it("handles graceful shutdown safely and idempotently", async () => {
    const fakeServer = new FakeServer();
    const fakeWatcher = new FakeWatcher();
    let exitCode: number | null = null;
    const { logger, logs } = createTestLogger();

    const result = await startServer({
      port: 8080,
      connectDatabase: async () => {},
      listen: (_port, _hostname, cb) => {
        if (cb) cb();
        return fakeServer;
      },
      createWatcher: () => fakeWatcher,
      logger,
      setExitCode: (code) => {
        exitCode = code;
      },
      registerSignalHandlers: false,
    });

    assert.equal(fakeWatcher.running, true);
    assert.equal(fakeServer.listening, true);

    // First shutdown call
    await result.shutdown("SIGTERM");

    assert.equal(fakeWatcher.stopCalls, 1);
    assert.equal(fakeWatcher.running, false);
    assert.equal(fakeServer.closeCalls, 1);
    assert.equal(fakeServer.listening, false);
    assert.ok(logs.some((l) => l.includes("Received SIGTERM. Stopping services gracefully...")));
    assert.ok(logs.some((l) => l.includes("Change stream watcher stopped")));
    assert.ok(logs.some((l) => l.includes("HTTP server closed")));

    // Second shutdown call (idempotency check)
    await result.shutdown("SIGINT");

    // Must NOT have called stop or close again
    assert.equal(fakeWatcher.stopCalls, 1);
    assert.equal(fakeServer.closeCalls, 1);
    assert.equal(exitCode, null);
  });

  it("attaches execution updates after listen and closes them during shutdown", async () => {
    const callOrder: string[] = [];
    const fakeServer = new FakeServer();
    const fakeWatcher = new FakeWatcher();
    let attachedTo: ServerLike | null = null;
    let webSocketCloseCalls = 0;
    let exitCode: number | null = null;
    const { logger } = createTestLogger();

    const noopClose = async () => {
      webSocketCloseCalls += 1;
      callOrder.push("webSocket.close");
    };

    const result = await startServer({
      port: 8080,
      connectDatabase: async () => {
        callOrder.push("connectDatabase");
      },
      listen: (_port, _hostname, cb) => {
        callOrder.push("listen");
        if (cb) cb();
        return fakeServer;
      },
      createWatcher: () => {
        callOrder.push("createWatcher");
        return fakeWatcher;
      },
      attachWebSocket: (server) => {
        attachedTo = server;
        callOrder.push("attachWebSocket");
        return { close: noopClose };
      },
      logger,
      setExitCode: (code) => {
        exitCode = code;
      },
      registerSignalHandlers: false,
    });

    assert.deepEqual(callOrder, [
      "connectDatabase",
      "listen",
      "attachWebSocket",
      "createWatcher",
    ]);
    assert.equal(attachedTo, fakeServer);
    assert.equal(webSocketCloseCalls, 0);

    const originalClose = fakeServer.close.bind(fakeServer);
    fakeServer.close = (callback?: (err?: Error) => void) => {
      callOrder.push("server.close");
      return originalClose(callback);
    };

    await result.shutdown("SIGTERM");

    // WebSocket resources are released before the HTTP listener is closed.
    assert.deepEqual(callOrder.slice(-2), ["webSocket.close", "server.close"]);
    assert.equal(webSocketCloseCalls, 1);
    assert.equal(fakeServer.closeCalls, 1);
    assert.equal(exitCode, null);
  });
});

