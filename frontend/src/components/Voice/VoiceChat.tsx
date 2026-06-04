import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Mic, MicOff, PhoneOff } from 'lucide-react';

interface VoiceChatProps {
  workspaceId: string;
  user: { username: string; id: string };
}

interface PeerInfo {
  socketId: string;
  user: { username: string; id: string };
  isSpeaking: boolean;
}

// Color hash function to ensure users have the same color everywhere in the app
const COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#a855f7', // purple
  '#ec4899', // pink
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

      socketRef.current = io('http://localhost:4000');
      socketRef.current.emit('join-voice-room', { workspaceId, user });

      socketRef.current.on('existing-voice-users', (existingPeers: {socketId: string, user: any}[]) => {
        setPeers(prev => {
          const newPeers = existingPeers.filter(ep => !prev.some(p => p.socketId === ep.socketId));
          return [...prev, ...newPeers.map(p => ({ ...p, isSpeaking: false }))];
        });
        existingPeers.forEach(p => {
          createPeerConnection(p.socketId, true);
        });
      });

      socketRef.current.on('user-joined-voice', ({ socketId, user: newUser }) => {
        setPeers(prev => [...prev, { socketId, user: newUser, isSpeaking: false }]);
        createPeerConnection(socketId, false);
      });

      socketRef.current.on('webrtc-offer', async ({ offer, from, user: fromUser }) => {
        setPeers(prev => {
          if (!prev.some(p => p.socketId === from)) {
            return [...prev, { socketId: from, user: fromUser, isSpeaking: false }];
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

  const disconnectVoice = () => {
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
  };

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
  }, []);

  if (!isConnected) {
    return (
      <button 
        onClick={connectToVoice}
        className="group flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-all duration-300 hover:border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-300 hover:shadow-[0_0_16px_rgba(16,185,129,0.15)]"
      >
        <Mic size={14} className="transition-transform duration-300 group-hover:scale-110" />
        Join Voice
      </button>
    );
  }

  return (
    <div className="relative">
      
      {/* Active Voice Trigger Button */}
      <div 
        onClick={() => setIsVoiceMenuOpen(!isVoiceMenuOpen)}
        className="flex cursor-pointer items-center gap-2 rounded-full border border-emerald-500/30 bg-[linear-gradient(135deg,rgba(16,185,129,0.15),rgba(5,150,105,0.05))] px-3 py-1.5 text-xs font-medium text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.1)] transition-all duration-300 hover:border-emerald-500/50 hover:bg-emerald-500/20"
      >
        <span className="relative flex h-2.5 w-2.5 mr-1">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
        </span>
        Voice Active ({peers.length + 1})
      </div>

      {/* Floating Panel with gradient top border */}
      <div className={`absolute right-0 top-full mt-3 w-64 rounded-2xl overflow-hidden shadow-[0_30px_60px_rgba(0,0,0,0.6),0_4px_20px_rgba(0,0,0,0.4)] ring-1 ring-black/50 transition-all duration-300 z-50 ${
        isVoiceMenuOpen 
          ? 'opacity-100 translate-y-0 pointer-events-auto' 
          : 'opacity-0 translate-y-2 pointer-events-none'
      }`}>
        {/* Gradient Top Accent */}
        <div className="h-[2px] w-full bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-500" />
        
        <div className="bg-[rgba(13,12,20,0.95)] backdrop-blur-2xl border border-white/[0.08] border-t-0 rounded-b-2xl">
          {/* Panel Header */}
          <div className="border-b border-white/5 bg-white/[0.03] p-3 flex justify-between items-center">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Voice Channel</span>
            <div className="flex gap-1.5">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMute();
                }}
                className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200 ${
                  isMuted 
                    ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25 shadow-[inset_0_0_0_1px_rgba(239,68,68,0.2)]' 
                    : 'bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]'
                }`}
                title={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
              </button>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  disconnectVoice();
                  setIsVoiceMenuOpen(false);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/10 text-red-400 shadow-[inset_0_0_0_1px_rgba(239,68,68,0.2)] transition-all duration-200 hover:bg-red-500 hover:text-white hover:shadow-none"
                title="Disconnect"
              >
                <PhoneOff size={14} />
              </button>
            </div>
          </div>
          
          {/* Participants List */}
          <div className="p-2 space-y-0.5 max-h-56 overflow-y-auto">
            
            {/* Local User */}
            <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl bg-white/5 border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
              <div 
                className={`relative flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm transition-all ${
                  isMuted ? 'opacity-40 grayscale' : 'ring-2 ring-white/20'
                }`}
                style={{ backgroundColor: getUserColor(user.username) }}
              >
                {user.username.substring(0, 2).toUpperCase()}
              </div>
              <span className="flex-1 truncate text-[13px] font-medium text-zinc-200">{user.username} <span className="text-zinc-500 font-normal">(You)</span></span>
              {isMuted && <MicOff size={14} className="text-red-400/80" />}
            </div>

            {/* Remote Peers */}
            {peers.map(p => (
              <div key={p.socketId} className="flex items-center gap-2.5 px-2 py-2 rounded-xl transition-colors hover:bg-white/5">
                <div 
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm border border-white/5"
                  style={{ backgroundColor: p.user?.username ? getUserColor(p.user.username) : '#3f3f46' }}
                >
                  {p.user?.username ? p.user.username.substring(0, 2).toUpperCase() : '??'}
                </div>
                <span className="flex-1 truncate text-[13px] font-medium text-zinc-300">{p.user?.username || 'Anonymous'}</span>
              </div>
            ))}
            
            {peers.length === 0 && (
               <div className="py-6 flex flex-col items-center justify-center gap-2 text-center">
                 <div className="h-8 w-8 rounded-full bg-white/5 flex items-center justify-center shadow-inner">
                   <Mic size={14} className="text-zinc-500" />
                 </div>
                 <span className="text-xs text-zinc-500">You're the only one here.</span>
               </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}