import { getPool } from '../db.js';

export interface UserEntity {
   id: string;
   username?: string;
   email?: string;
   github_id?: string | null;
   avatar_url?: string | null;
   github_token?: string | null;
}

export class UserRepository {
   async findByGithubIdOrEmail(githubId: string, email: string): Promise<UserEntity | null> {
      const res = await getPool().query<UserEntity>(
         'SELECT id, username, email, github_id, avatar_url FROM users WHERE github_id = $1 OR email = $2',
         [githubId, email]
      );
      return res.rows[0] || null;
   }

   async updateGithubInfo(id: string, githubId: string, avatarUrl: string, accessToken: string): Promise<void> {
      await getPool().query(
         'UPDATE users SET github_id = $1, avatar_url = $2, github_token = $3 WHERE id = $4',
         [githubId, avatarUrl, accessToken, id]
      );
   }

   async createUser(username: string, email: string, githubId?: string, avatarUrl?: string, githubToken?: string): Promise<UserEntity> {
      const res = await getPool().query<UserEntity>(
         'INSERT INTO users (username, email, github_id, avatar_url, github_token) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, avatar_url',
         [username, email, githubId || null, avatarUrl || null, githubToken || null]
      );
      return res.rows[0]!;
   }

   async findByUsernameOrEmail(username: string, email: string): Promise<UserEntity | null> {
      const res = await getPool().query<UserEntity>(
         'SELECT id FROM users WHERE username = $1 OR email = $2',
         [username, email]
      );
      return res.rows[0] || null;
   }

   async findByUsername(username: string): Promise<UserEntity | null> {
      const res = await getPool().query<UserEntity>(
         'SELECT id FROM users WHERE username = $1',
         [username]
      );
      return res.rows[0] || null;
   }

   async findById(id: string): Promise<UserEntity | null> {
      const res = await getPool().query<UserEntity>(
         'SELECT id, username, email, avatar_url, github_token FROM users WHERE id = $1',
         [id]
      );
      return res.rows[0] || null;
   }
}

export const userRepository = new UserRepository();
