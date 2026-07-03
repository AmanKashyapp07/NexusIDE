import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Mic, MicOff, PhoneOff, Users } from 'lucide-react';
import { wsUrl } from '../../lib/backendUrls';

interface VoiceUser {
  username: string;
  id: string;
}

interface VoiceChatProps {
  workspaceId: string;
  user: VoiceUser;
}

interface PeerInfo {
  socketId: string;
  user: VoiceUser;
}

const COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
];

const getUserColor = (username: string) => {
  if (!username) return '#3f3f46';
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
};

export default function VoiceChat({ workspaceId, user }: VoiceChatProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [isVoiceMenuOpen, setIsVoiceMenuOpen] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<{ [socketId: string]: RTCPeerConnection }>({});
  const remoteAudioRefs = useRef<{ [socketId: string]: HTMLAudioElement }>({});

  const connectToVoice = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setIsConnected(true);
      setIsMuted(false);

      const token = localStorage.getItem('token') || '';
      socketRef.current = io(wsUrl('').replace(/^ws/, 'http'), {
        auth: { token }
      });
      socketRef.current.emit('join-voice-room', { workspaceId, user });

      socketRef.current.on('existing-voice-users', (existingPeers: { socketId: string; user: VoiceUser }[]) => {
        setPeers(prev => {
          const newPeers = existingPeers.filter(ep => !prev.some(p => p.socketId === ep.socketId));
          return [...prev, ...newPeers];
        });
        existingPeers.forEach(p => {
          createPeerConnection(p.socketId, true);
        });
      });

      socketRef.current.on('user-joined-voice', ({ socketId, user: newUser }) => {
        setPeers(prev => [...prev, { socketId, user: newUser }]);
        createPeerConnection(socketId, false);
      });

      socketRef.current.on('webrtc-offer', async ({ offer, from, user: fromUser }) => {
        setPeers(prev => {
          if (!prev.some(p => p.socketId === from)) {
            return [...prev, { socketId: from, user: fromUser }];
          }
          return prev;
        });

        let pc = peerConnectionsRef.current[from];
        if (!pc) {
          pc = createPeerConnection(from, false);
        }
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socketRef.current?.emit('webrtc-answer', { answer, to: from });
      });

      socketRef.current.on('webrtc-answer', async ({ answer, from }) => {
        const pc = peerConnectionsRef.current[from];
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
      });

      socketRef.current.on('webrtc-ice-candidate', async ({ candidate, from }) => {
        const pc = peerConnectionsRef.current[from];
        if (pc) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      });

      socketRef.current.on('user-left-voice', (socketId) => {
        if (peerConnectionsRef.current[socketId]) {
          peerConnectionsRef.current[socketId].close();
          delete peerConnectionsRef.current[socketId];
        }
        setPeers(prev => prev.filter(p => p.socketId !== socketId));
      });

    } catch (err) {
      console.error('Error accessing microphone:', err);
      alert('Could not access microphone. Please check permissions.');
    }
  };

  const createPeerConnection = (socketId: string, isInitiator: boolean) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    peerConnectionsRef.current[socketId] = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit('webrtc-ice-candidate', { candidate: event.candidate, to: socketId });
      }
    };

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        let audio = remoteAudioRefs.current[socketId];
        if (!audio) {
          audio = new Audio();
          audio.autoplay = true;
          remoteAudioRefs.current[socketId] = audio;
        }
        audio.srcObject = event.streams[0];
      }
    };

    if (isInitiator) {
      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        socketRef.current?.emit('webrtc-offer', { offer, to: socketId, user });
      });
    }

    return pc;
  };

  const disconnectVoice = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
    peerConnectionsRef.current = {};
    remoteAudioRefs.current = {};
    setPeers([]);
    setIsConnected(false);
  }, []);

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  useEffect(() => {
    return () => {
      disconnectVoice();
    };
  }, [disconnectVoice]);

  if (!isConnected) {
    return (
      <button 
        onClick={connectToVoice}
        className="group flex items-center gap-1.5 rounded-md border border-transparent px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-[#2a2d2e] hover:text-white"
      >
        <Mic size={14} className="text-zinc-500 transition-colors group-hover:text-zinc-300" />
        <span>Join Voice</span>
      </button>
    );
  }

  return (
    <div className="relative">
      
      {/* Active State Button */}
      <button 
        onClick={() => setIsVoiceMenuOpen(!isVoiceMenuOpen)}
        className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
          isVoiceMenuOpen 
            ? 'bg-[#2a2d2e] border-[#404040] text-white' 
            : 'bg-[#252526] border-[#333333] text-emerald-400 hover:bg-[#2a2d2e] hover:border-[#404040]'
        }`}
      >
        <span className="relative flex h-2 w-2 mr-0.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        Voice Connected
      </button>

      {/* Popover Menu */}
      <div 
        className={`absolute right-0 top-full mt-2 w-64 origin-top-right rounded-md border border-[#333333] bg-[#1e1e1e] p-1 shadow-xl transition-all duration-150 z-50 ${
          isVoiceMenuOpen 
            ? 'opacity-100 scale-100 pointer-events-auto' 
            : 'opacity-0 scale-95 pointer-events-none'
        }`}
      >
        {/* Header Actions */}
        <div className="flex items-center justify-between border-b border-[#2b2b2b] px-2 pb-2 pt-1 mb-1">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Users size={12} />
            <span className="text-[10px] font-semibold uppercase tracking-wider">Channel ({peers.length + 1})</span>
          </div>
          
          <div className="flex gap-1">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                toggleMute();
              }}
              className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                isMuted 
                  ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' 
                  : 'text-zinc-400 hover:bg-[#2a2d2e] hover:text-white'
              }`}
              title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
            >
              {isMuted ? <MicOff size={13} /> : <Mic size={13} />}
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                disconnectVoice();
                setIsVoiceMenuOpen(false);
              }}
              className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-red-500 hover:text-white"
              title="Disconnect"
            >
              <PhoneOff size={13} />
            </button>
          </div>
        </div>
        
        {/* User List */}
        <div className="p-1 max-h-60 overflow-y-auto ide-scrollbar space-y-0.5">
          {/* Local User */}
          <div className="flex items-center gap-2.5 rounded px-2 py-1.5 bg-[#252526] border border-[#2b2b2b]">
            <div 
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white transition-opacity ${
                isMuted ? 'opacity-40 grayscale' : ''
              }`}
              style={{ backgroundColor: getUserColor(user.username) }}
            >
              {user.username.substring(0, 2).toUpperCase()}
            </div>
            <div className="flex flex-1 items-center justify-between min-w-0">
              <span className="truncate text-[13px] text-white">
                {user.username} <span className="text-zinc-500">(You)</span>
              </span>
              {isMuted && <MicOff size={12} className="text-red-400 shrink-0 ml-2" />}
            </div>
          </div>

          {/* Remote Peers */}
          {peers.map(p => (
            <div key={p.socketId} className="flex items-center gap-2.5 rounded px-2 py-1.5 transition-colors hover:bg-[#2a2d2e]">
              <div 
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white"
                style={{ backgroundColor: p.user?.username ? getUserColor(p.user.username) : '#3f3f46' }}
              >
                {p.user?.username ? p.user.username.substring(0, 2).toUpperCase() : '??'}
              </div>
              <span className="truncate text-[13px] text-zinc-300">
                {p.user?.username || 'Anonymous'}
              </span>
            </div>
          ))}
          
          {/* Empty State */}
          {peers.length === 0 && (
             <div className="py-4 flex flex-col items-center justify-center gap-1.5 text-center px-2">
               <div className="h-7 w-7 rounded-full bg-[#252526] flex items-center justify-center border border-[#2b2b2b]">
                 <Users size={12} className="text-zinc-500" />
               </div>
               <span className="text-[11px] text-zinc-500">Waiting for others to join...</span>
             </div>
          )}
        </div>
      </div>

      {/* Reusable thin scrollbar style specifically for the popover (if not defined globally) */}
      <style>
        {`
          .ide-scrollbar::-webkit-scrollbar {
            width: 6px;
          }
          .ide-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .ide-scrollbar::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 3px;
          }
          .ide-scrollbar::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.2);
          }
        `}
      </style>
    </div>
  );
}