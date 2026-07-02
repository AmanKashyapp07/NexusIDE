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

    res.redirect(`http://localhost:5173/auth/callback?token=${token}`);
  } catch (error: any) {
    console.error('GitHub Auth Error:', error.response?.data || error.message);
    res.status(500).send('Authentication failed');
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