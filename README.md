# Backend API

Backend API for the Casio Hostel Management System. Built with Node.js, Express, TypeScript, and PostgreSQL.

## Features

- 🔐 Authentication & Authorization (JWT-based)
- 🏠 Hostel Management
- 👥 Student & Tenant Management
- 💰 Payment Processing
- 📊 Analytics & Reporting
- 🛏️ Room Management & Assignments
- 📦 Inventory Management
- 💸 Expense Tracking
- 🎓 Semester Management
- 📧 Email Notifications
- 🔒 Security (Helmet, CORS, Rate Limiting)
- 📈 Multi-tenant Analytics

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: PostgreSQL
- **Authentication**: JWT (JSON Web Tokens)
- **File Upload**: Multer
- **Email**: Nodemailer
- **Security**: Helmet, CORS, express-rate-limit

## Project Structure

```
backend/
├── src/
│   ├── config/          # Configuration files
│   │   └── database.ts   # Database connection
│   ├── database/         # Database related files
│   │   ├── migrations/   # Database migrations
│   │   ├── initialize.ts # Database initialization
│   │   └── migrations.ts # Migration runner
│   ├── models/           # Database models
│   ├── routes/           # API route handlers
│   ├── services/         # Business logic services
│   ├── utils/            # Utility functions
│   └── index.ts          # Application entry point
├── scripts/              # Deployment scripts
├── docs/                 # Documentation
├── uploads/              # File uploads storage
├── .env                  # Environment variables (not in repo)
├── env.example           # Environment variables template
├── package.json
└── tsconfig.json
```

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- PostgreSQL (v12 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp env.example .env
# Edit .env with your configuration
```

4. Set up the database:
```bash
# Create PostgreSQL database
createdb your_database_name

# Run migrations (runs automatically on startup)
npm run migrate
```

5. Build the project:
```bash
npm run build
```

6. Start the server:
```bash
# Development
npm run dev

# Production
npm start
```

## Environment Variables

See `env.example` for all required environment variables. Key variables include:

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret key for JWT tokens
- `PORT` - Server port (default: 5000)
- `FRONTEND_URL` or `FRONTEND_URLS` - Allowed frontend origins
- `NODE_ENV` - Environment (development/production)
- Email configuration (SMTP settings)

## Available Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm run migrate` - Run database migrations
- `npm run setup:super-admin` - Create super admin user
- `npm run deploy` - Run deployment script
- `npm run sync-db` - Sync database (includes build)
- `npm run check-migrations` - Check migration status
- `npm run fix-migrations` - Fix migration state
- `npm run test-email` - Test email configuration

## Database Migrations

The project uses an automatic migration system. Migrations are stored in `src/database/migrations/` and run automatically on server startup.

### Creating a New Migration

1. Create a new file in `src/database/migrations/`:
   - Format: `00XX-description.ts`
   - Example: `0012-add-feature.ts`

2. Export a default async function:
```typescript
import pool from '../../config/database';

export default async function runMigration() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Your migration SQL here
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

3. The migration will run automatically on next startup.

### Manual Migration

To run migrations manually:
```bash
npm run migrate
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Hostels
- `GET /api/hostels` - List hostels
- `POST /api/hostels` - Create hostel
- `GET /api/hostels/:id` - Get hostel details
- `PUT /api/hostels/:id` - Update hostel
- `DELETE /api/hostels/:id` - Delete hostel

### Students
- `GET /api/students` - List students
- `POST /api/students` - Create student
- `GET /api/students/:id` - Get student details
- `PUT /api/students/:id` - Update student

### Payments
- `GET /api/payments` - List payments
- `POST /api/payments` - Create payment
- `GET /api/payments/:id` - Get payment details

### Rooms
- `GET /api/rooms` - List rooms
- `POST /api/rooms` - Create room
- `PUT /api/rooms/:id` - Update room
- `DELETE /api/rooms/:id` - Delete room

### Analytics
- `GET /api/analytics` - Get analytics data
- `GET /api/multi-tenant-analytics` - Multi-tenant analytics

... and more. See route files for complete API documentation.

## Security

- **Helmet**: Sets various HTTP headers for security
- **CORS**: Configurable cross-origin resource sharing
- **Rate Limiting**: Prevents abuse with request rate limits
- **JWT Authentication**: Secure token-based authentication
- **Password Hashing**: bcryptjs for password security
- **Input Validation**: Zod for request validation

## Deployment

See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for detailed deployment instructions.

### Quick Deployment Steps

1. Set up environment variables on your server
2. Install dependencies: `npm install`
3. Build: `npm run build`
4. Run migrations: `npm run migrate` (or let it run on startup)
5. Start server: `npm start` (or use PM2/systemd)

## Development

### Code Style

- TypeScript strict mode enabled
- ESLint for code quality (if configured)
- Consistent naming conventions

### Debugging

Debug scripts are available in `src/debug/`:
- Check migration status
- Test email configuration
- Database utilities

## Contributing

1. Create a feature branch
2. Make your changes
3. Write tests if applicable
4. Submit a pull request

## License

ISC

## Support

For issues and questions, please open an issue on the repository.
