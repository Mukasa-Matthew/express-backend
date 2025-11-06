# Complete SQL Removal Migration Plan

This document outlines the systematic removal of all SQL-based database logic.

## Overview

**Goal:** Remove all `pool` imports and SQL queries, replacing them with Prisma ORM.

**Files Affected:** ~50+ files

## Phase 1: Models ✅ COMPLETE
- [x] User.ts
- [x] Hostel.ts  
- [x] University.ts
- [ ] Semester.ts
- [ ] SubscriptionPlan.ts
- [ ] AuthSettings.ts

## Phase 2: Critical Routes (Priority: Start Here)
- [ ] auth.ts (most critical - login/logout)
- [ ] hostels.ts (core functionality)
- [ ] students.ts
- [ ] rooms.ts

## Phase 3: Other Routes
- [ ] payments.ts
- [ ] semesters.ts
- [ ] subscription-plans.ts
- [ ] universities.ts
- [ ] custodians.ts
- [ ] expenses.ts
- [ ] inventory.ts
- [ ] hostel-images.ts
- [ ] analytics.ts
- [ ] multi-tenant-analytics.ts
- [ ] public.ts
- [ ] auth-settings.ts

## Phase 4: Services & Utilities
- [ ] subscriptionNotificationService.ts
- [ ] semesterService.ts
- [ ] semesterMiddleware.ts

## Phase 5: Cleanup
- [ ] Remove `src/config/database.ts` (or mark deprecated)
- [ ] Remove `src/database/migrations.ts`
- [ ] Remove `src/database/migrations/` folder (all 11 files)
- [ ] Remove `src/database/create-all-tables.sql`
- [ ] Remove `src/database/schema.sql`
- [ ] Remove `src/database/run-create-all-tables.ts`
- [ ] Remove `src/database/setup.ts`
- [ ] Update/remove debug scripts in `src/debug/`

## Quick Reference: SQL → Prisma Conversions

### Find by ID
```typescript
// OLD
const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
return result.rows[0] || null;

// NEW
return await prisma.user.findUnique({ where: { id } });
```

### Find All
```typescript
// OLD
const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
return result.rows;

// NEW
return await prisma.user.findMany({
  orderBy: { createdAt: 'desc' }
});
```

### Find with Condition
```typescript
// OLD
const result = await pool.query(
  'SELECT * FROM users WHERE email = $1 AND role = $2',
  [email, role]
);
return result.rows[0] || null;

// NEW
return await prisma.user.findFirst({
  where: {
    email: { equals: email, mode: 'insensitive' },
    role: role
  }
});
```

### Create
```typescript
// OLD
const result = await pool.query(
  'INSERT INTO users (email, name, password, role) VALUES ($1, $2, $3, $4) RETURNING *',
  [email, name, password, role]
);
return result.rows[0];

// NEW
return await prisma.user.create({
  data: { email, name, password, role }
});
```

### Update
```typescript
// OLD
const result = await pool.query(
  'UPDATE users SET name = $1, email = $2 WHERE id = $3 RETURNING *',
  [name, email, id]
);
return result.rows[0] || null;

// NEW
return await prisma.user.update({
  where: { id },
  data: { name, email }
});
```

### Delete
```typescript
// OLD
const result = await pool.query('DELETE FROM users WHERE id = $1', [id]);
return (result.rowCount || 0) > 0;

// NEW
try {
  await prisma.user.delete({ where: { id } });
  return true;
} catch (error: any) {
  if (error.code === 'P2025') return false; // Not found
  throw error;
}
```

### Count
```typescript
// OLD
const result = await pool.query('SELECT COUNT(*) as count FROM users');
return parseInt(result.rows[0].count);

// NEW
return await prisma.user.count();
```

### Complex Query with JOIN
```typescript
// OLD
const result = await pool.query(`
  SELECT u.*, h.name as hostel_name
  FROM users u
  LEFT JOIN hostels h ON u.hostel_id = h.id
  WHERE u.id = $1
`, [id]);

// NEW
const user = await prisma.user.findUnique({
  where: { id },
  include: { hostel: true }
});
// Then map: { ...user, hostel_name: user.hostel?.name }
```

## Testing Strategy

After each file is migrated:
1. Test all endpoints that use that file
2. Verify database operations work
3. Check error handling
4. Test edge cases

## Rollback Plan

If issues arise:
1. Old SQL files are still in git history
2. Can temporarily revert to `pool` if needed
3. Keep `database.ts` until migration is 100% complete

## Estimated Time

- Models: ~2-3 hours
- Routes: ~8-12 hours
- Services: ~2-3 hours
- Cleanup: ~1 hour
- **Total: ~15-20 hours**

## Next Steps

1. Complete remaining models (Semester, SubscriptionPlan, AuthSettings)
2. Start with auth.ts route (most critical)
3. Move to hostels.ts
4. Continue systematically through other routes
5. Update services
6. Final cleanup

