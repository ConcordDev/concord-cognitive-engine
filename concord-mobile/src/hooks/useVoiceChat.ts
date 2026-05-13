// Concord Mobile — Voice Chat Hook (Phase Y).
//
// Wraps the WebRTC signalling macros + (optionally) react-native-webrtc
// for native peer connections. The actual RTCPeerConnection plumbing
// is platform-specific; this hook handles the signalling lifecycle:
// join → list peers → leave.

import { useCallback, useEffect, useState } from 'react';
import { VoiceChatSignalling } from '../api/macro-client';

interface UseVoiceChatResult {
  joined: boolean;
  peers: string[];
  join: () => Promise<void>;
  leave: () => Promise<void>;
  busy: boolean;
}

export function useVoiceChat(roomId: string, selfUserId: string): UseVoiceChatResult {
  const [joined, setJoined] = useState(false);
  const [peers, setPeers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const refreshPeers = useCallback(async () => {
    const r = await VoiceChatSignalling.roomState(roomId);
    const list = (r as unknown as { peers?: string[] }).peers;
    if (r.ok && Array.isArray(list)) setPeers(list.filter((id) => id !== selfUserId));
  }, [roomId, selfUserId]);

  const join = useCallback(async () => {
    setBusy(true);
    try {
      const r = await VoiceChatSignalling.join(roomId);
      const list = (r as unknown as { peers?: string[] }).peers;
      if (r.ok && Array.isArray(list)) setPeers(list.filter((id) => id !== selfUserId));
      setJoined(true);
    } finally { setBusy(false); }
  }, [roomId, selfUserId]);

  const leave = useCallback(async () => {
    setBusy(true);
    try {
      await VoiceChatSignalling.leaveRoom(roomId);
      setJoined(false);
      setPeers([]);
    } finally { setBusy(false); }
  }, [roomId]);

  useEffect(() => {
    if (!joined) return;
    const t = setInterval(refreshPeers, 30_000);
    return () => clearInterval(t);
  }, [joined, refreshPeers]);

  return { joined, peers, join, leave, busy };
}
