"use client";

import { useEffect, useRef, useState } from "react";

export type WSEvent = {
  type: string;
  ts: number;
  data?: Record<string, unknown>;
};

const WS_URL = (() => {
  const base = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080";
  return base.replace(/^http/, "ws") + "/api/v1/ws";
})();

type Listener = (e: WSEvent) => void;
const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoff = 1000;

function ensureSocket() {
  if (typeof window === "undefined") return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  try {
    socket = new WebSocket(WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }
  socket.onopen = () => { backoff = 1000; };
  socket.onmessage = (msg) => {
    try {
      const evt = JSON.parse(msg.data) as WSEvent;
      listeners.forEach((l) => l(evt));
    } catch { /* ignore non-JSON */ }
  };
  socket.onclose = () => { scheduleReconnect(); };
  socket.onerror = () => { try { socket?.close(); } catch { /* */ } };
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    backoff = Math.min(backoff * 2, 30000);
    ensureSocket();
  }, backoff);
}

export function useRealtime(handler: Listener) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    const cb: Listener = (e) => handlerRef.current(e);
    listeners.add(cb);
    ensureSocket();
    return () => { listeners.delete(cb); };
  }, []);
}

export function useRealtimeStatus() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = setInterval(() => {
      setOpen(socket?.readyState === WebSocket.OPEN);
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return open;
}
