# Prisma Setup Instructions

## Quick Fix Steps

1. **Generate Prisma Client** (run this first):
   ```bash
   cd backend
   npm run prisma:generate
   ```

2. **After Prisma Client is generated**, update the type imports in your model files:

   In `src/models/User.ts`, replace:
   ```typescript
   type PrismaUser = any;
   type PrismaUserUpdateInput = any;
   ```
   
   With:
   ```typescript
   import { User as PrismaUser, Prisma } from '@prisma/client';
   type PrismaUserUpdateInput = Prisma.UserUpdateInput;
   ```

   In `src/models/Hostel.ts`, replace:
   ```typescript
   type PrismaHostel = any;
   type PrismaHostelUpdateInput = any;
   ```
   
   With:
   ```typescript
   import { Hostel as PrismaHostel, Prisma } from '@prisma/client';
   type PrismaHostelUpdateInput = Prisma.HostelUpdateInput;
   ```

3. **Set up DATABASE_URL** in your `.env` file:
   ```env
   DATABASE_URL="postgresql://user:password@localhost:5432/lts_portal"
   ```

4. **For existing database** (if you already have tables):
   
   Option A - Introspect your existing database:
   ```bash
   npx prisma db pull
   ```
   This will update `prisma/schema.prisma` to match your existing database.

   Option B - Mark migration as applied:
   ```bash
   # Create migration without applying
   npx prisma migrate dev --create-only --name init
   
   # Mark it as applied (since tables already exist)
   npx prisma migrate resolve --applied <migration_name>
   ```

## Current Status

✅ Prisma schema created (`backend/prisma/schema.prisma`)
✅ User model refactored to use Prisma
✅ Hostel model refactored to use Prisma
✅ Package.json updated with Prisma scripts
⏳ Prisma Client needs to be generated
⏳ Type imports need to be updated after generation

## Next Steps

After generating Prisma Client and fixing the type imports:

1. Test the refactored models
2. Continue refactoring other models (University, Semester, SubscriptionPlan, AuthSettings)
3. Update database initialization
4. Update routes if needed

## Troubleshooting

If you get errors about missing Prisma Client:
- Run `npm run prisma:generate`
- Make sure `DATABASE_URL` is set in `.env`
- Restart your dev server

If types are still showing errors:
- Update the type imports as shown above
- Make sure Prisma Client was generated successfully


