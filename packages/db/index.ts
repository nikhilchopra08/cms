import { prisma } from './client' // exports instance of prisma
export const prismaClient = prisma;
export * from "./generated/prisma/client" // exports generated types from prisma