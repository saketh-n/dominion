import http from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { SERVER_PORT, WORLD_ROOM } from "@game/shared";
import { WorldRoom } from "./rooms/WorldRoom.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const httpServer = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define(WORLD_ROOM, WorldRoom);

httpServer.listen(SERVER_PORT, () => {
  console.log(`[server] listening on http://localhost:${SERVER_PORT}`);
});
