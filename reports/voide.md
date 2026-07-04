<!-- MERGED FROM: voice_chat.md -->

# Voice Chat System: A First-Principles Technical Report

This report explains the design, architecture, and step-by-step mechanics of the real-time voice chat feature implemented in the collaborative IDE.

---

## 1. Core Architecture: Why WebRTC Mesh?

In modern web applications, real-time voice communication is usually solved in one of two ways:
1. **SFU/MCU (Selective Forwarding Unit / Multipoint Control Unit)**: A centralized media server receives media streams from all participants, processes or duplicates them, and sends them out. This is highly scalable but requires expensive server infrastructure, decoding/encoding overhead, and introduces latency.
2. **P2P Mesh Network**: Clients connect directly to each other. Every participant establishes a separate peer-to-peer connection with every other participant. 

For our IDE, we chose a **P2P Mesh Architecture** because:
- **Zero Media Server Overhead**: The backend does not process or relay any audio data. It only handles lightweight signaling.
- **Ultra-Low Latency**: Audio packets route directly between users' machines.
- **Complexity Scale**: For small-team collaborative workspaces (typically 2-8 concurrent editors), a mesh network is extremely efficient ($O(N^2)$ connections, where $N$ is the number of users).

```mermaid
graph TD;
    subgraph Signaling Phase (Through Server)
        ClientA[User A] <-->|Socket.io Signaling| Server[Express Server]
        ClientB[User B] <-->|Socket.io Signaling| Server
    end
    subgraph Media Phase (Direct P2P)
        ClientA <===>|WebRTC Peer Connection (SRTP Audio)| ClientB
    end
```

---

## 2. The Step-by-Step Lifecycle (First Principles)

WebRTC (Web Real-Time Communication) cannot establish a connection out of thin air. Since browsers do not know each other's public IP addresses or network topologies (due to NATs and Firewalls), they need an intermediary to exchange connection metadata. This process is called **Signaling**.

Here is the exact step-by-step sequence of events when a user joins the voice chat.

### Phase A: Accessing Hardware
1. A user clicks **"Join Voice"**.
2. The browser executes `navigator.mediaDevices.getUserMedia({ audio: true })`.
3. This prompts the user for microphone access. Once granted, it returns a `MediaStream` containing an `AudioStreamTrack`.

### Phase B: Connecting to the Signaling Broker
1. The client establishes a connection to our Socket.io server (`socket.io-client`).
2. The client emits `join-voice-room` with their `workspaceId` and user profile.
3. The server registers the socket into a Socket.io room matching the `workspaceId`.
4. The server responds with:
   - A broadcast to existing room members: `user-joined-voice` (contains the new user's socket ID and user profile details).
   - A direct emit to the new user: `existing-voice-users` (contains a list of objects with the socket ID and user profile data of all existing peers currently in the room).

---

### Phase C: WebRTC Peer Connection Handshake (SDP & ICE)

For every peer in the room, a dedicated `RTCPeerConnection` object is constructed. One peer acts as the **Initiator** (who sends the offer), and the other acts as the **Receiver** (who sends the answer).

```
User A (Initiator)                                 Signaling Server                                  User B (Receiver)
       |                                                   |                                                 |
       |--- 1. Create RTCPeerConnection ------------------>|                                                 |
       |--- 2. Add local audio tracks -------------------->|                                                 |
       |--- 3. Create Offer (SDP Description) ------------>|                                                 |
       |--- 4. Send Offer -------------------------------->|------------------------------------------------>|
       |                                                   |                                                 |--- 5. Create RTCPeerConnection
       |                                                   |                                                 |--- 6. Set Remote Description (Offer)
       |                                                   |                                                 |--- 7. Add local audio tracks
       |                                                   |                                                 |--- 8. Create Answer (SDP Description)
       |                                                   |<------------------------------------------------|--- 9. Send Answer
       |<--------------------------------------------------|                                                 |
       |--- 10. Set Remote Description (Answer) ---------->|                                                 |
       |                                                   |                                                 |
       |================================= CONNECTION ESTABLISHED ============================================|
```

#### Detailed Steps:
1. **Local Tracks**: Both peers add their local microphone track to their respective `RTCPeerConnection` instances via:
   ```typescript
   localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
   ```
2. **SDP Offer Creation**: The initiator generates a Session Description Protocol (SDP) packet using `pc.createOffer()`. SDP is a text-based format detailing codecs, media formats, and connection details.
3. **Setting Local Description**: The initiator sets this description locally (`pc.setLocalDescription(offer)`) and sends it via Socket.io to the receiver.
4. **Setting Remote & Creating Answer**: The receiver receives the offer, sets it as the remote descriptor (`pc.setRemoteDescription(offer)`), creates an SDP answer (`pc.createAnswer()`), sets it as its own local descriptor, and sends the answer back to the initiator.
5. **Completing SDP Handshake**: The initiator receives the answer and sets it as the remote descriptor (`pc.setRemoteDescription(answer)`).

---

### Phase D: NAT Traversal using ICE Candidates

While the SDP handshake specifies *what* media to send, the **ICE (Interactive Connectivity Establishment)** framework determines *how* to route the packets through the internet.

1. As soon as `RTCPeerConnection` is initialized, the browser communicates with a public **STUN (Session Traversal Utilities for NAT)** server (we use Google's free stun: `stun.l.google.com:19302`).
2. The STUN server returns the browser's public IP address and port (its NAT mapping).
3. The browser generates **ICE Candidates** containing these routing details.
4. For every generated candidate, the browser triggers the `onicecandidate` event. The client sends this candidate through Socket.io to the specific remote peer.
5. The remote peer receives the candidate and registers it using `pc.addIceCandidate(candidate)`.
6. Once a viable pathway is found, the browsers automatically switch from signaling to direct P2P data flow.

---

### Phase E: Media Output
1. When a connection begins receiving audio packets, the `RTCPeerConnection` triggers the `ontrack` event.
2. The client intercepts this event and extracts the remote `MediaStream`:
   ```typescript
   pc.ontrack = (event) => {
     if (event.streams && event.streams[0]) {
       let audio = new Audio();
       audio.autoplay = true;
       audio.srcObject = event.streams[0];
     }
   };
   ```
3. The audio starts playing dynamically and immediately out of the user's speakers or headphones.

---

## 3. UI/UX and State Controls

To ensure a seamless user experience, we implemented the following features:
- **Local Mute/Unmute**: Disabling a track locally is cleaner than deleting it. We toggle the `enabled` property of the `AudioStreamTrack` (`track.enabled = !track.enabled`). This keeps the WebRTC connection open but stops sending audio packets.
- **Graceful Cleanup**: When a user leaves voice or closes the tab:
  1. We stop all tracks in `localStream` to turn off the microphone light on their computer.
  2. We call `socket.disconnect()` to cleanly sever connection to the signaling namespace.
  3. We iterate through all peer connections and call `pc.close()`, releasing system resources.
- **Visual Collaboration Panel**: By leveraging standard hover triggers and absolute styling, the UI shows a clean indicator in the top header ("Voice Active (N)") which expands on hover to display active users, mute flags, and a disconnect trigger.

---

## 4. Summary of Socket.io Signaling Protocol

Below are the raw socket events routed by the backend signaling server:

| Event Name | Direction | Payload | Description |
| :--- | :--- | :--- | :--- |
| `join-voice-room` | Client -> Server | `{ workspaceId, user }` | Informs the server the client is joining a specific workspace's voice channel. |
| `user-joined-voice` | Server -> Clients | `{ socketId, user }` | Broadcasted to existing room members to announce a new user. |
| `existing-voice-users` | Server -> Client | `[{ socketId: string, user: any }]` | Direct payload to the new user containing objects with the socket ID and user profile details of all existing peers in the room. |
| `webrtc-offer` | Client -> Server -> Client | `{ offer, to, user }` | Routes a WebRTC SDP offer from an initiator to a specific peer. |
| `webrtc-answer` | Client -> Server -> Client | `{ answer, to }` | Routes a WebRTC SDP answer from a receiver back to the initiator. |
| `webrtc-ice-candidate`| Client -> Server -> Client | `{ candidate, to }` | Relays ICE candidates between negotiating peers. |
| `user-left-voice` | Server -> Clients | `string` (Socket ID) | Broadcasted when a socket disconnects, notifying peers to teardown that connection. |