import { Router } from 'express';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { userRepository } from '../repositories/user.repository.js';

interface GitHubEmail {
   email: string;
   primary: boolean;
}

interface GitHubUserResponse {
   id: number;
   login: string;
   avatar_url: string;
}

const router = Router();

router.get('/github', (_req, res) => {
   const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
   const redirectUri = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=user:email,repo`;
   res.redirect(redirectUri);
});

router.get('/github/callback', async (req, res) => {
   const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
   const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
   const code = req.query.code as string | undefined;
   if (!code) {
      return res.status(400).send('No code provided');
   }

   try {
      const tokenResponse = await axios.post<{ access_token?: string }>(
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

      const userResponse = await axios.get<GitHubUserResponse>('https://api.github.com/user', {
         headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      const emailsResponse = await axios.get<GitHubEmail[]>('https://api.github.com/user/emails', {
         headers: { Authorization: `Bearer ${accessToken}` }
      });

      const githubUser = userResponse.data;
      const primaryEmail = emailsResponse.data.find(e => e.primary)?.email || emailsResponse.data[0]?.email;
      
      if (!primaryEmail) {
         return res.status(400).send('GitHub email required');
      }

      const githubId = githubUser.id.toString();
      const username = githubUser.login;
      const avatarUrl = githubUser.avatar_url;

      const dbUser = await userRepository.findByGithubIdOrEmail(githubId, primaryEmail);
      let userId: string;

      if (dbUser) {
         userId = dbUser.id;
         await userRepository.updateGithubInfo(userId, githubId, avatarUrl, accessToken);
      } else {
         const newUser = await userRepository.createUser(username, primaryEmail, githubId, avatarUrl, accessToken);
         userId = newUser.id;
      }

      const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
      const token = jwt.sign({ id: userId, username }, JWT_SECRET, { expiresIn: '7d' });

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      res.redirect(`${frontendUrl.replace(/\/$/, '')}/auth/callback?token=${token}`);
   } catch (error: unknown) {
      const errObj = error as { response?: { data?: unknown }; message?: string };
      console.error('GitHub Auth Error:', errObj.response?.data || errObj.message);
      res.status(500).send('Authentication failed');
   }
});

router.post('/test-login', async (req, res) => {
   try {
      const { username, password } = req.body as { username?: string; password?: string };
      if (!username || !password) {
         return res.status(400).json({ error: 'Username and password required' });
      }

      if (username.length < 2 || username.length > 30) {
         return res.status(400).json({ error: 'Username must be 2-30 characters' });
      }

      const email = `${username.toLowerCase()}@test.local`;
      const dbUser = await userRepository.findByUsernameOrEmail(username, email);
      let userId: string;

      if (dbUser) {
         userId = dbUser.id;
      } else {
         const newUser = await userRepository.createUser(
            username,
            email,
            undefined,
            `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(username)}`
         );
         userId = newUser.id;
      }

      const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
      const token = jwt.sign({ id: userId, username }, JWT_SECRET, { expiresIn: '7d' });

      res.json({ token, user: { id: userId, username } });
   } catch (error: unknown) {
      const pgErr = error as { code?: string; message?: string };
      if (pgErr.code === '23505') {
         const dbUser = await userRepository.findByUsername(req.body.username as string);
         if (dbUser) {
            const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
            const token = jwt.sign({ id: dbUser.id, username: dbUser.username }, JWT_SECRET, { expiresIn: '7d' });
            return res.json({ token, user: { id: dbUser.id, username: dbUser.username } });
         }
      }
      console.error('Test login error:', pgErr.message);
      res.status(500).json({ error: 'Login failed' });
   }
});

router.get('/me', async (req, res) => {
   try {
      const token = req.headers.authorization?.split(' ')[1];
      if (!token) return res.status(401).json({ error: 'No token provided' });

      const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
      const decoded = jwt.verify(token, JWT_SECRET) as { id: string };
      
      const user = await userRepository.findById(decoded.id);
      if (!user) {
         return res.status(404).json({ error: 'User not found' });
      }

      res.json({ user });
   } catch {
      res.status(401).json({ error: 'Invalid token' });
   }
});

export default router;