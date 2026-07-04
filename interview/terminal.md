# Interactive Web Terminals: Pseudoterminal (PTY) Allocation & Stream Piping

This document details the first-principles design of web-based interactive terminals (e.g., browser-based terminal emulators connected to live Docker shells). It explains pseudoterminal (PTY) allocation, binary stream multiplexing, and resizing mechanics for technical architecture interviews.

---

## 1. Pseudoterminal (PTY) Allocation

To understand how a web terminal works, we must differentiate between running a stateless shell command and spawning an **interactive terminal session**.

### A. TTY vs. Non-TTY Executions
When running code in a standard container, we execute the process in a **Non-TTY** mode. The stdout and stderr are demuxed by Docker's remote API protocol (which prefixes output chunks with an 8-byte header specifying stream type and payload length).

When running an **interactive shell** (like `bash` or `sh`), we require a **TTY (Teletypewriter)**.
- **Tty: true**: This instructs the Linux kernel inside the container to allocate a virtual **PTY (Pseudoterminal)** pair (comprising a master descriptor and a slave descriptor).
- **Interactive Capabilities**: With a PTY allocated, the running shell realizes it is connected to a terminal. It enables keyboard shortcut trapping (e.g. `Ctrl+C` to SIGINT, `Ctrl+D` to EOF), shell history features (GNU Readline), auto-completions, and terminal color profiles (by returning true when checking `isatty(1)`).
- **Stream Merging**: In TTY mode, stdout and stderr are combined at the kernel level inside the container and streamed over a single raw socket, removing the need for protocol header demuxing in the backend.

### B. Workspace Container Mapping
In [terminalHandler.ts](file:///Users/amankashyap/Documents/sandbox/backend/src/terminal/terminalHandler.ts), we coordinate terminal connections:
1.  **WebSocket Endpoint**: Client hits `ws://localhost:4000/terminal/<workspaceId>`.
2.  **Container Retrieval**: The server retrieves the workspace's warm container.
3.  **Exec Allocation**: The backend calls `container.exec` to initialize `/bin/bash` with `Tty: true`:
    ```typescript
    const exec = await container.exec({
      Cmd: ['/bin/bash'],
      Tty: true,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: '/app',
      Env: execEnv
    });
    ```
4.  **Socket Hijacking**: The server starts the exec process, hijacking the socket (`hijack: true`):
    ```typescript
    const stream = await exec.start({ hijack: true, stdin: true, Tty: true });
    ```
    This returns a raw TCP/Unix socket stream mapped directly to the bash process's master PTY descriptor.

---

## 2. Bi-Directional Stream Piping & Rate Limiting

The backend acts as a bridge, piping binary data between the client's WebSocket and the Docker container's hijacked PTY stream:

```
┌──────────────────┐               WebSocket (JSON/Raw)             ┌────────────────┐
│ Browser xterm.js │ <────────────────────────────────────────────> │ Node.js Server │
└──────────────────┘                                                └────────────────┘
                                                                            ▲
                                                                            │ Raw TCP Stream
                                                                            ▼
                                                                    ┌────────────────┐
                                                                    │ Docker daemon  │
                                                                    └────────────────┘
                                                                            ▲
                                                                            │ PTY Master/Slave
                                                                            ▼
                                                                    ┌────────────────┐
                                                                    │ Sandbox Shell  │
                                                                    └────────────────┘
```

### A. Raw Keystroke Transmission
When a user types in the browser-based `xterm.js` editor, the library captures keystrokes and transmits them as raw ANSI characters (or escape sequences like `\u001b[A` for the Up Arrow) over the WebSocket connection.
The server receives the raw buffer and writes it directly to the container exec stream:
```typescript
ws.on('message', (messageData) => {
  const data = Buffer.isBuffer(messageData) ? messageData : Buffer.from(messageData);
  if (session.stream && session.stream.writable) {
    session.stream.write(data);
  }
});
```

### B. Output Buffering & Rate Limiting
If a process prints excessive output very rapidly (e.g. running `yes` or executing an infinite printing loop), the raw TCP stream emits chunks faster than the browser can parse and paint them. This leads to **browser thread locking** and tab crashes.

To mitigate this, the backend implements **Output Rate Limiting**:
- **Batching**: Output chunks are collected in a buffer and flushed to the client at a fixed interval of `50ms` (`OUTPUT_RATE_LIMIT_MS = 50`).
- **Throttling**: If the accumulated chunks exceed `64KB` (`OUTPUT_RATE_LIMIT_BYTES = 64000`) before the timer ticks, the buffer is flushed immediately to prevent memory ballooning in the Node.js server.
- Batched streaming yields highly responsive terminal rendering while protecting the client from resource exhaustion.

### C. History Buffer caching
When a WebSocket disconnects (e.g. network switch), the container continues running. If we kill the container immediately, the user's execution state is lost. 
To prevent this:
- The server grants a **15-second grace period** before tearing down the session.
- A **Terminal History Buffer** keeps the last `100KB` of terminal output in server memory.
- When the client reconnects, the server immediately flushes the combined history buffer to the client's WebSocket. `xterm.js` parses the escape codes and restores the terminal display to the exact state it was in before the drop.

---

## 3. Dynamic Terminal Resizing (Cols & Rows)

Terminal applications (like `vim`, `nano`, or `less`) compute layout dimensions based on the terminal's column and row size. If the browser window is resized but the container's PTY is not updated, text wrapping corrupts, and editors display distorted lines.

### Resizing flow (Standard vs. Simplified)
While our current core system defaults to standard terminal sizes for standard terminal shells, the dynamic resize flow operates as follows:

1.  **UI Resize Event**: In the browser, `xterm.js` registers a resize event (e.g., using the `FitAddon`). It calculates the new grid dimensions (e.g., 120 columns, 40 rows).
2.  **WebSocket Control Message**: The client sends a structured JSON control packet over the WebSocket connection:
    ```json
    {
      "type": "resize",
      "cols": 120,
      "rows": 40
    }
    ```
3.  **Command Interception**: The Node.js server parses the message. Instead of piping it directly to stdin, it intercepts the packet and checks the message type.
4.  **PTY Size Update**: The server calls the Dockerode API `exec.resize()` to programmatically tell the container's PTY controller to adjust columns and rows:
    ```typescript
    if (data.type === 'resize') {
      await exec.resize({ h: data.rows, w: data.cols });
    }
    ```
5.  **Signal Propagation**: The Linux kernel sends a `SIGWINCH` (Window Change) signal to the foreground process in the container, forcing applications like `vim` to redraw their UI layout for the new dimensions.
