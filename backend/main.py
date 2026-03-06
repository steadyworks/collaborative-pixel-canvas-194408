import asyncio
import json
import os
from datetime import datetime, timezone

import aiosqlite
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = os.getenv("DB_PATH", "/tmp/canvas.db")


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS placements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                x INTEGER NOT NULL,
                y INTEGER NOT NULL,
                color TEXT NOT NULL,
                placer TEXT NOT NULL,
                placed_at TEXT NOT NULL
            )
        """)
        await db.commit()


class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, message: dict):
        text = json.dumps(message)
        dead = []
        for ws in list(self.active):
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()


@app.on_event("startup")
async def startup():
    await init_db()


@app.get("/api/canvas")
async def get_canvas():
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("""
            SELECT x, y, color, placer, placed_at
            FROM placements p1
            WHERE id = (
                SELECT MAX(id) FROM placements p2
                WHERE p2.x = p1.x AND p2.y = p1.y
            )
        """) as cursor:
            rows = await cursor.fetchall()
    return [
        {"x": r[0], "y": r[1], "color": r[2], "placer": r[3], "placed_at": r[4]}
        for r in rows
    ]


@app.get("/api/history")
async def get_history():
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("""
            SELECT x, y, color, placer, placed_at
            FROM placements
            ORDER BY id ASC
        """) as cursor:
            rows = await cursor.fetchall()
    return [
        {"x": r[0], "y": r[1], "color": r[2], "placer": r[3], "placed_at": r[4]}
        for r in rows
    ]


class PixelData(BaseModel):
    x: int
    y: int
    color: str
    placer: str


@app.post("/api/pixels")
async def place_pixel(data: PixelData):
    if not (0 <= data.x <= 63 and 0 <= data.y <= 63):
        return JSONResponse(status_code=400, content={"error": "Out of bounds"})

    placed_at = datetime.now(timezone.utc).isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO placements (x, y, color, placer, placed_at) VALUES (?, ?, ?, ?, ?)",
            (data.x, data.y, data.color, data.placer, placed_at),
        )
        await db.commit()

    pixel = {
        "type": "pixel",
        "x": data.x,
        "y": data.y,
        "color": data.color,
        "placer": data.placer,
        "placed_at": placed_at,
    }
    await manager.broadcast(pixel)
    return pixel


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)
    except Exception:
        manager.disconnect(ws)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3001)
