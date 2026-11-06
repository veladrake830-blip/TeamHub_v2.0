-- DropIndex
DROP INDEX "Session_previousTokenHash_idx";

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "previousTokenHash",
DROP COLUMN "rotatedAt";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "resetLockedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "UsedRefreshToken" (
    "tokenHash" TEXT NOT NULL,
    "sessionId" UUID NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsedRefreshToken_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateIndex
CREATE INDEX "UsedRefreshToken_sessionId_idx" ON "UsedRefreshToken"("sessionId");

-- AddForeignKey
ALTER TABLE "UsedRefreshToken" ADD CONSTRAINT "UsedRefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

