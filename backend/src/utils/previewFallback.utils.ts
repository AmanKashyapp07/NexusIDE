export const PREVIEW_FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sandbox Server Not Started | NexusIDE</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=JetBrains+Mono:wght@400;700&display=swap');
    :root {
      --bg: #07060b;
      --card-bg: rgba(25, 22, 40, 0.4);
      --border: rgba(147, 51, 234, 0.15);
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --purple: #a855f7;
      --purple-hover: #c084fc;
    }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Outfit', sans-serif;
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      overflow: hidden;
    }
    .container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      backdrop-filter: blur(16px);
      border-radius: 20px;
      padding: 40px;
      max-width: 480px;
      width: 90%;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05);
      text-align: center;
    }
    .icon {
      font-size: 48px;
      margin-bottom: 20px;
      display: inline-block;
      animation: pulse 2s infinite ease-in-out;
    }
    h1 {
      font-size: 24px;
      font-weight: 700;
      margin: 0 0 10px 0;
      background: linear-gradient(135deg, #fff 0%, var(--purple) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p {
      color: var(--text-muted);
      font-size: 15px;
      line-height: 1.6;
      margin: 0 0 24px 0;
    }
    .instructions {
      text-align: left;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .instructions h2 {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 0 0 12px 0;
      color: var(--purple);
    }
    .instructions p {
      font-size: 13px;
      margin: 0 0 8px 0;
      color: var(--text);
    }
    code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      background: rgba(168, 85, 247, 0.1);
      color: var(--purple-hover);
      padding: 4px 8px;
      border-radius: 6px;
      display: block;
      word-break: break-all;
      margin-top: 6px;
      border: 1px solid rgba(168, 85, 247, 0.15);
    }
    .btn {
      display: inline-block;
      background: var(--purple);
      color: #fff;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      transition: background 0.2s;
    }
    .btn:hover {
      background: var(--purple-hover);
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.05); opacity: 0.8; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">🔌</div>
    <h1>Preview Server Offline</h1>
    <p>We could not reach any active web server running on port 3000 inside your sandbox container.</p>
    
    <div class="instructions">
      <h2>How to start your app</h2>
      <p>1. Open the IDE terminal panel.</p>
      <p>2. Launch a web application on port 3000:</p>
      <code>npx http-server -p 3000</code>
      <code>npm run dev -- --port 3000</code>
    </div>
    
    <a href="#" onclick="window.location.reload()" class="btn">Refresh Preview</a>
  </div>
</body>
</html>`;
