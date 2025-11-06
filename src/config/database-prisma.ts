import { PrismaClient } from '@prisma/client';
import prisma from '../lib/prisma';

// Re-export Prisma client for convenience
export { prisma };
export default prisma;

// For backward compatibility, you can still use the pool connection if needed
// But Prisma should handle most database operations
export { PrismaClient };




