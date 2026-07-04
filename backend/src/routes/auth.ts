import { Router } from 'express';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { getPool } from '../db';

const router = Router();

// Redirect to GitHub OAuth
router.get('/github', (req, res) => {
  const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
  const redirectUri = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=user:email,repo`;
  res.redirect(redirectUri);
});

// GitHub OAuth Callback
router.get('/github/callback', async (req, res) => {
  const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
  const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('No code provided');
  }

  try {
    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code
      },
      { headers: { Accept: 'application/json' } }
    );

    const accessToken = tokenResponse.data.access_token;
    if (!accessToken) {
       return res.status(400).send('Failed to fetch access token');
    }

    const userResponse = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    const emailsResponse = await axios.get('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const githubUser = userResponse.data;
    const primaryEmail = emailsResponse.data.find((e: any) => e.primary)?.email || emailsResponse.data[0]?.email;
    
    if (!primaryEmail) {
      return res.status(400).send('GitHub email required');
    }

    const githubId = githubUser.id.toString();
    const username = githubUser.login;
    const avatarUrl = githubUser.avatar_url;

    const pool = getPool();
    // Use email to link existing users who registered before GitHub OAuth
    let dbUser = await pool.query('SELECT * FROM users WHERE github_id = $1 OR email = $2', [githubId, primaryEmail]);
    let userId;

    if (dbUser.rows.length > 0) {
      userId = dbUser.rows[0].id;
      await pool.query('UPDATE users SET github_id = $1, avatar_url = $2, github_token = $3 WHERE id = $4', [githubId, avatarUrl, accessToken, userId]);
    } else {
      const newUser = await pool.query(
        'INSERT INTO users (username, email, github_id, avatar_url, github_token) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [username, primaryEmail, githubId, avatarUrl, accessToken]
      );
      userId = newUser.rows[0].id;
    }

    const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
    const token = jwt.sign({ id: userId, username }, JWT_SECRET, { expiresIn: '7d' });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl.replace(/\/$/, '')}/auth/callback?token=${token}`);
  } catch (error: any) {
    console.error('GitHub Auth Error:', error.response?.data || error.message);
    res.status(500).send('Authentication failed');
  }
});

// =============================================================================
// [DEV ONLY] Test Login — username/password bypass for local multi-user testing
// =============================================================================
// Creates or finds a user by username. No real password hashing — this is purely
// for testing collaboration with multiple browser tabs on the same machine.
router.post('/test-login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    if (username.length < 2 || username.length > 30) {
      return res.status(400).json({ error: 'Username must be 2-30 characters' });
    }

    const pool = getPool();
    const email = `${username.toLowerCase()}@test.local`;

    // Check if user already exists
    let dbUser = await pool.query('SELECT * FROM users WHERE username = $1 OR email = $2', [username, email]);
    let userId: string;

    if (dbUser.rows.length > 0) {
      userId = dbUser.rows[0].id;
    } else {
      // Auto-create the test user
      const newUser = await pool.query(
        'INSERT INTO users (username, email, avatar_url) VALUES ($1, $2, $3) RETURNING id',
        [username, email, `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(username)}`]
      );
      userId = newUser.rows[0].id;
    }

    const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
    const token = jwt.sign({ id: userId, username }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ token, user: { id: userId, username } });
  } catch (error: any) {
    // Handle unique constraint violation (race condition)
    if (error.code === '23505') {
      const pool = getPool();
      const dbUser = await pool.query('SELECT id, username FROM users WHERE username = $1', [req.body.username]);
      if (dbUser.rows.length > 0) {
        const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
        const token = jwt.sign({ id: dbUser.rows[0].id, username: dbUser.rows[0].username }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ token, user: { id: dbUser.rows[0].id, username: dbUser.rows[0].username } });
      }
    }
    console.error('Test login error:', error.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get Current User (Me)
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    
    const userResult = await getPool().query('SELECT id, username, email, avatar_url FROM users WHERE id = $1', [decoded.id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: userResult.rows[0] });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;