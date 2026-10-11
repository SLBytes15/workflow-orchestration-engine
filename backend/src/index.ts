import app from "./app";

const PORT = Number(process.env.PORT) || 3000;

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`[STARTUP] Server listening at http://127.0.0.1:${PORT}`);
});

server.on("error", (error) => {
  console.error("[SERVER ERROR]", error);
});
