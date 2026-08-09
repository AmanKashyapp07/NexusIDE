import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
   user?: {
      id: string;
      username: string;
   };
}

export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction): Response | void => {
   let token = req.headers.authorization?.split(' ')[1];

   if (!token && req.query.token) {
      token = req.query.token as string;
   }

   if (!token && req.headers.cookie) {
      const cookies: Record<string, string> = {};
      req.headers.cookie.split(';').forEach(cookie => {
         const parts = cookie.trim().split('=');
         if (parts[0]) {
            cookies[parts[0]] = parts[1] || '';
         }
      });
      token = cookies['preview_token'] || cookies['nexus_ide_token'] || cookies['token'];
   }

   if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
   }

   try {
      const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
      const decoded = jwt.verify(token, JWT_SECRET) as { id: string; username: string };
      req.user = decoded;
      next();
   } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
   }
};