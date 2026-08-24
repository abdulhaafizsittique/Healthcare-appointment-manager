const { PrismaClient } = require("@prisma/client");

// Single shared Prisma instance (avoids exhausting DB connections in dev
// with hot-reload, and gives us one place to hook query logging).
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

module.exports = prisma;
