import * as dotenv from 'dotenv'
import type { Config } from 'drizzle-kit'

dotenv.config()

// Parse DATABASE_URL
const dbUrl = new URL(process.env.DATABASE_URL || '')

export default {
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: dbUrl.hostname,
    port: parseInt(dbUrl.port),
    user: dbUrl.username,
    password: dbUrl.password,
    database: dbUrl.pathname.slice(1), // Remove leading slash
  },
} satisfies Config
