// server/lib/binary-protocol.js
//
// Dense binary frame protocol for godot-gateway.js
//
// Replaces JSON.stringify/JSON.parse for the 30Hz spatial update path.
// Under load (500 users × 30Hz = 15,000 packets/sec), JSON serialization
// blocks the Node event loop and triggers event_loop_lag spikes that breach
// the 5000ms CONCORD_LAG_THRESHOLD_MS.
//
// Format (little-endian):
//   [4 bytes: total length N]
//   [1 byte:  msgType (0x01=player:move, 0x02=world:sync, 0x03=evt)]
//   [2 bytes: payload section length]
//   [N-7 bytes: UTF-8 payload (evt name + tagged fields)]
//
// String section is still UTF-8 (so existing client JSON contracts work),
// but the envelope (type/length) is binary — saves ~60 bytes per frame
// vs the JSON envelope alone, and avoids JSON.parse overhead on the hot path.
//
// Backwards-compatible: clients can fall back to JSON if first 4 bytes
// don't decode as a valid length (start with '{').
//
// Why not Protobuf? Zero-deps beats a 200KB dep for this critical path.
// Why not MessagePack? Adding an npm dep + verifying perf in production
// takes longer than this 80-line format and the savings are ~5%.

const HEADER_SIZE = 7; // 4 (length) + 1 (type) + 2 (string-section-len)

const TYPE_MAP = {
  move: 0x01,
  sync: 0x02,
  evt:  0x03,
};

const TYPE_INV = {
  0x01: 'move',
  0x02: 'sync',
  0x03: 'evt',
};

/**
 * Encode a frame as a Buffer.
 */
export function encodeFrame(type, payload) {
  const payloadStr = JSON.stringify(payload);
  const payloadBytes = Buffer.byteLength(payloadStr, 'utf8');
  const totalLen = HEADER_SIZE + payloadBytes;

  const buf = Buffer.allocUnsafe(totalLen);
  buf.writeUInt32LE(totalLen, 0);
  buf.writeUInt8(TYPE_MAP[type] ?? 0x03, 4);
  buf.writeUInt16LE(payloadBytes, 5);
  if (payloadBytes) buf.write(payloadStr, HEADER_SIZE, 'utf8');

  return buf;
}

/**
 * Decode a frame from a Buffer. Returns null if it isn't a binary frame.
 */
export function decodeFrame(buf) {
  if (buf.length < HEADER_SIZE) return null;

  const view = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const length = view.readUInt32LE(0);

  // Sanity: length must match the buffer and include header
  if (length !== view.length) return null;

  const typeByte = view.readUInt8(4);
  const payloadLen = view.readUInt16LE(5);

  if (payloadLen !== length - HEADER_SIZE) return null;

  const type = TYPE_INV[typeByte];
  if (!type) return null;

  const payloadStr = view.toString('utf8', HEADER_SIZE, HEADER_SIZE + payloadLen);
  let payload;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return null;
  }

  return { type, payloadStr, payload };
}

/**
 * Detect whether a message is binary-encoded or JSON.
 */
export function isBinaryFrame(buf) {
  if (buf.length < HEADER_SIZE) return false;
  // Binary frame: length-prefixed header (4 bytes little-endian uint32 = total length)
  // JSON frame: starts with '{'
  return buf[0] !== 0x7B; // not '{'
}

/**
 * Specialized tighter encoder for player:move packets (95% of 30Hz traffic).
 * Fixed binary layout, no JSON.stringify inside the hot path.
 *
 * Layout:
 *   [4 len][1 type=move][2 plen][1 playerIdLen][playerId][4 x][4 y][4 z]
 *   [2 rot×100][2 velX×100][2 velY×100][2 velZ×100][4 seq][8 ts]
 */
export function encodeMove(p) {
  const idBytes = Buffer.byteLength(p.playerId, 'utf8');
  const payloadLen = 1 + idBytes + 4 + 4 + 4 + 2 + 2 + 2 + 2 + 4 + 8; // 35 + idLen
  const totalLen = HEADER_SIZE + payloadLen;

  const buf = Buffer.allocUnsafe(totalLen);
  buf.writeUInt32LE(totalLen, 0);
  buf.writeUInt8(TYPE_MAP.move, 4);
  buf.writeUInt16LE(payloadLen, 5);
  let off = HEADER_SIZE;
  buf.writeUInt8(idBytes, off); off += 1;
  buf.write(p.playerId, off, 'utf8'); off += idBytes;
  buf.writeFloatLE(p.x, off); off += 4;
  buf.writeFloatLE(p.y, off); off += 4;
  buf.writeFloatLE(p.z, off); off += 4;
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((p.rot ?? 0) * 100))), off); off += 2;
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((p.velX ?? 0) * 100))), off); off += 2;
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((p.velY ?? 0) * 100))), off); off += 2;
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((p.velZ ?? 0) * 100))), off); off += 2;
  buf.writeUInt32LE((p.seq ?? 0) >>> 0, off); off += 4;
  buf.writeBigUInt64LE(BigInt(p.ts ?? Date.now()), off);

  return buf;
}

/**
 * Decode a move packet from its tight binary form.
 */
export function decodeMove(buf) {
  if (buf.length < HEADER_SIZE) return null;
  const view = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const length = view.readUInt32LE(0);
  if (length !== view.length) return null;
  if (view.readUInt8(4) !== TYPE_MAP.move) return null;
  const payloadLen = view.readUInt16LE(5);
  if (payloadLen !== length - HEADER_SIZE) return null;

  let off = HEADER_SIZE;
  const idLen = view.readUInt8(off); off += 1;
  const playerId = view.toString('utf8', off, off + idLen); off += idLen;
  const x = view.readFloatLE(off); off += 4;
  const y = view.readFloatLE(off); off += 4;
  const z = view.readFloatLE(off); off += 4;
  const rot = view.readInt16LE(off) / 100; off += 2;
  const velX = view.readInt16LE(off) / 100; off += 2;
  const velY = view.readInt16LE(off) / 100; off += 2;
  const velZ = view.readInt16LE(off) / 100; off += 2;
  const seq = view.readUInt32LE(off); off += 4;
  const ts = Number(view.readBigUInt64LE(off));

  return { playerId, x, y, z, rot, velX, velY, velZ, seq, ts };
}

export default { encodeFrame, decodeFrame, isBinaryFrame, encodeMove, decodeMove };
