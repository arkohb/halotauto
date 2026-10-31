import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// After `prisma db push` adds NEW models, the dev server's cached singleton
// still points at the pre-push client (missing e.g. pineStrategy/license).
// Detect that and re-instantiate so hot reloads pick the generated schema up.
function clientIsCurrent(c: PrismaClient): boolean {
  return 'pineStrategy' in c && 'license' in c && 'journalTrade' in c && 'journalState' in c && 'journalEquity' in c
}

function makeClient(): PrismaClient {
  const c = new PrismaClient({ log: ['query'] })
  globalForPrisma.prisma = c
  return c
}

export const db =
  globalForPrisma.prisma && clientIsCurrent(globalForPrisma.prisma)
    ? globalForPrisma.prisma
    : makeClient()

if (process.env.NODE_ENV !== 'production' && globalForPrisma.prisma) {
  globalForPrisma.prisma = db
}
