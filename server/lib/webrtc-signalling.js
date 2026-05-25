// server/lib/webrtc-signalling.js
//
// Minimal WebRTC signalling for in-lens video calls (telehealth, future
// Spaces audio, code Live Share cursor presence).
//
// The server is purely a relay — it doesn't terminate media, decrypt
// streams, or hold any keys. It only forwards SDP offers/answers and
// ICE candidates between paired clients in the same `webrtc:${visitId}`
// room.
//
// Wire protocol on the main Socket.IO connection:
//   - webrtc:join     { visitId } → server joins client to room +
//                                   replies with `webrtc:peer-list`
//                                   (existing peers in the room)
//   - webrtc:offer    { visitId, sdp, target? }    → relay
//   - webrtc:answer   { visitId, sdp, target? }    → relay
//   - webrtc:ice      { visitId, candidate, target? } → relay
//   - webrtc:leave    { visitId } → server removes client from room +
//                                   broadcasts `webrtc:peer-left`
//
// `target` is an optional recipient socket id. When absent the message
// is broadcast to every other peer in the room (1:1 calls work either
// way; multi-party prefers explicit targeting).
//
// Auth: each socket carries `socket.data.userId` (set by the auth
// middleware in server.js when the socket handshake includes a JWT or
// auth cookie). Anonymous sockets can still signal — call privacy is
// enforced by the `visitId` itself being a UUID + only being shared
// with the patient + provider, not by the signalling layer.

export function attachWebRTCSignalling(io) {
  if (!io || typeof io.on !== "function") return;
  io.on("connection", (socket) => {
    socket.on("webrtc:join", ({ visitId } = {}) => {
      if (!visitId) return;
      const room = `webrtc:${visitId}`;
      socket.join(room);
      // Tell the joiner who's already in the room so they can initiate
      // offers to existing peers.
      const peers = [];
      try {
        const sockets = io.sockets.adapter.rooms.get(room);
        if (sockets) {
          for (const sid of sockets) {
            if (sid !== socket.id) peers.push(sid);
          }
        }
      } catch { /* ignore */ }
      socket.emit("webrtc:peer-list", { visitId, peers });
      // Tell everyone else in the room that a new peer arrived.
      socket.to(room).emit("webrtc:peer-joined", { visitId, peerId: socket.id });
    });

    const relay = (event) => ({ visitId, sdp, candidate, target } = {}) => {
      if (!visitId) return;
      const room = `webrtc:${visitId}`;
      const payload = { visitId, fromPeerId: socket.id };
      if (sdp !== undefined) payload.sdp = sdp;
      if (candidate !== undefined) payload.candidate = candidate;
      if (target) {
        io.to(target).emit(event, payload);
      } else {
        socket.to(room).emit(event, payload);
      }
    };
    socket.on("webrtc:offer",  relay("webrtc:offer"));
    socket.on("webrtc:answer", relay("webrtc:answer"));
    socket.on("webrtc:ice",    relay("webrtc:ice"));

    socket.on("webrtc:leave", ({ visitId } = {}) => {
      if (!visitId) return;
      const room = `webrtc:${visitId}`;
      socket.leave(room);
      io.to(room).emit("webrtc:peer-left", { visitId, peerId: socket.id });
    });

    socket.on("disconnect", () => {
      // Best-effort: announce the disconnect to every webrtc:* room
      // this socket was in. Socket.IO automatically removes the socket
      // from rooms on disconnect, but peers might still hold a stale
      // connection — telling them lets them tear down gracefully.
      try {
        for (const room of socket.rooms) {
          if (typeof room === "string" && room.startsWith("webrtc:")) {
            const visitId = room.slice("webrtc:".length);
            socket.to(room).emit("webrtc:peer-left", { visitId, peerId: socket.id });
          }
        }
      } catch { /* ignore */ }
    });
  });
}
