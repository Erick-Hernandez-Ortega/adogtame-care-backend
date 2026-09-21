import { randomBytes } from 'node:crypto';

process.env.JWT_ACCESS_TOKEN_SECRET = randomBytes(32).toString('hex');
process.env.JWT_ACCESS_TOKEN_TTL_SECONDS = '3600';
