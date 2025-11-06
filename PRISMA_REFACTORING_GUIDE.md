# Prisma Refactoring Guide

This guide documents the systematic removal of all SQL-based database logic and migration to Prisma ORM.

## Status

✅ **Completed:**
- Database initialization updated to use Prisma
- User model refactored to Prisma
- Hostel model refactored to Prisma
- Prisma schema created with all tables

⏳ **In Progress:**
- Remaining models (University, Semester, SubscriptionPlan, AuthSettings)
- Routes (50+ files need updating)
- Services (subscriptionNotificationService, semesterService)
- Utilities (semesterMiddleware)

⏳ **Pending:**
- Remove old SQL migration files
- Remove old database.ts file
- Update debug scripts

## Common Patterns for Refactoring

### Pattern 1: Simple SELECT Query

**Before (SQL):**
```typescript
const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
return result.rows[0] || null;
```

**After (Prisma):**
```typescript
const user = await prisma.user.findUnique({
  where: { id }
});
return user;
```

### Pattern 2: SELECT with JOIN

**Before (SQL):**
```typescript
const result = await pool.query(`
  SELECT u.*, r.name as region_name
  FROM universities u
  LEFT JOIN regions r ON u.region_id = r.id
  WHERE u.id = $1
`, [id]);
return result.rows[0] || null;
```

**After (Prisma):**
```typescript
const university = await prisma.university.findUnique({
  where: { id },
  include: {
    region: true
  }
});
// Map to your interface if needed
return university ? {
  ...university,
  region_name: university.region?.name
} : null;
```

### Pattern 3: INSERT Query

**Before (SQL):**
```typescript
const result = await pool.query(
  'INSERT INTO users (email, name, password, role) VALUES ($1, $2, $3, $4) RETURNING *',
  [email, name, password, role]
);
return result.rows[0];
```

**After (Prisma):**
```typescript
const user = await prisma.user.create({
  data: {
    email,
    name,
    password,
    role
  }
});
return user;
```

### Pattern 4: UPDATE Query

**Before (SQL):**
```typescript
const result = await pool.query(
  'UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
  [name, id]
);
return result.rows[0] || null;
```

**After (Prisma):**
```typescript
const user = await prisma.user.update({
  where: { id },
  data: {
    name,
    // updated_at is automatically handled by Prisma
  }
});
return user;
```

### Pattern 5: DELETE Query

**Before (SQL):**
```typescript
const result = await pool.query('DELETE FROM users WHERE id = $1', [id]);
return (result.rowCount || 0) > 0;
```

**After (Prisma):**
```typescript
try {
  await prisma.user.delete({
    where: { id }
  });
  return true;
} catch (error) {
  if (error.code === 'P2025') return false; // Record not found
  throw error;
}
```

### Pattern 6: Complex Aggregations

**Before (SQL):**
```typescript
const result = await pool.query(`
  SELECT 
    COUNT(*) as total,
    SUM(amount) as total_amount
  FROM payments
  WHERE hostel_id = $1
`, [hostelId]);
return result.rows[0];
```

**After (Prisma):**
```typescript
const stats = await prisma.payment.aggregate({
  where: {
    student: {
      hostelId: hostelId
    }
  },
  _count: {
    id: true
  },
  _sum: {
    amount: true
  }
});
return {
  total: stats._count.id,
  total_amount: stats._sum.amount || 0
};
```

### Pattern 7: Transactions

**Before (SQL):**
```typescript
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('INSERT INTO users ...', []);
  await client.query('UPDATE hostels ...', []);
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

**After (Prisma):**
```typescript
await prisma.$transaction(async (tx) => {
  await tx.user.create({ data: {...} });
  await tx.hostel.update({ where: { id }, data: {...} });
});
```

## Files to Update

### Models (Priority: High)
- [x] User.ts
- [x] Hostel.ts
- [ ] University.ts
- [ ] Semester.ts
- [ ] SubscriptionPlan.ts
- [ ] AuthSettings.ts

### Routes (Priority: High)
- [ ] auth.ts
- [ ] hostels.ts
- [ ] students.ts
- [ ] rooms.ts
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

### Services (Priority: Medium)
- [ ] subscriptionNotificationService.ts
- [ ] semesterService.ts

### Utilities (Priority: Medium)
- [ ] semesterMiddleware.ts

### Database Files (Priority: Low - Remove after migration)
- [ ] migrations.ts (old migration system)
- [ ] migrations/ (all old migration files)
- [ ] setup-super-admin.ts (already updated in initialize.ts)
- [ ] run-create-all-tables.ts
- [ ] setup.ts
- [ ] create-all-tables.sql
- [ ] schema.sql

### Debug Scripts (Priority: Low)
- [ ] All files in debug/ folder (can be updated or removed)

## Migration Steps

1. **Update models first** - They're used by routes
2. **Update routes systematically** - Start with most critical (auth, hostels)
3. **Update services** - They depend on models
4. **Update utilities** - Lower priority
5. **Remove old files** - Only after everything is migrated and tested

## Testing Checklist

After each file is updated:
- [ ] Test all endpoints in that file
- [ ] Verify database operations work correctly
- [ ] Check error handling
- [ ] Verify transactions work if used
- [ ] Test edge cases (empty results, not found, etc.)

## Notes

- Prisma automatically handles `created_at` and `updated_at` timestamps
- Prisma uses `camelCase` for field names, but our schema maps to `snake_case` in DB
- Use `include` for relations instead of JOINs
- Use `select` to limit returned fields
- Use `where` with complex conditions instead of raw SQL
- For very complex queries, use `prisma.$queryRaw` sparingly

