-- CreateTable
CREATE TABLE "OrganizationSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkPlan" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkTask" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "result" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "WorkTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkPlan_date_idx" ON "WorkPlan"("date");

-- CreateIndex
CREATE UNIQUE INDEX "WorkPlan_userId_date_key" ON "WorkPlan"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "WorkTask_planId_position_key" ON "WorkTask"("planId", "position");

-- AddForeignKey
ALTER TABLE "WorkPlan" ADD CONSTRAINT "WorkPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WorkPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A single row of organization settings.
ALTER TABLE "OrganizationSettings" ADD CONSTRAINT "OrganizationSettings_one_row" CHECK ("id" = 1);
INSERT INTO "OrganizationSettings" ("id", "timezone", "updatedAt") VALUES (1, 'Europe/Moscow', CURRENT_TIMESTAMP);
