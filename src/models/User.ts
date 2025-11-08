import prisma from '../lib/prisma';
import pool from '../config/database';
import { User as PrismaUser, Prisma } from '@prisma/client';
type PrismaUserUpdateInput = Prisma.UserUpdateInput;

export interface User {
  id: number;
  username?: string | null;
  email: string;
  name: string;
  password: string;
  role: 'super_admin' | 'hostel_admin' | 'tenant' | 'user' | 'custodian';
  hostel_id?: number | null;
  profile_picture?: string | null;
  password_is_temp?: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateUserData {
  username?: string;
  email: string;
  name: string;
  password: string;
  role: 'super_admin' | 'hostel_admin' | 'tenant' | 'user' | 'custodian';
  hostel_id?: number;
  password_is_temp?: boolean;
}

// Helper function to convert Prisma User to our User interface
function prismaUserToUser(prismaUser: PrismaUser): User {
  return {
    id: prismaUser.id,
    username: prismaUser.username,
    email: prismaUser.email,
    name: prismaUser.name,
    password: prismaUser.password,
    role: prismaUser.role as User['role'],
    hostel_id: prismaUser.hostelId,
    profile_picture: prismaUser.profilePicture,
    password_is_temp: prismaUser.passwordIsTemp ?? false,
    created_at: prismaUser.createdAt,
    updated_at: prismaUser.updatedAt,
  };
}

export class UserModel {
  static async create(userData: CreateUserData): Promise<User> {
    const { email, name, password, role, username, hostel_id, password_is_temp } = userData;

    try {
      const prismaUser = await prisma.user.create({
        data: {
          email,
          name,
          password,
          role,
          username: username || null,
          hostelId: hostel_id || null,
          passwordIsTemp: password_is_temp ?? false,
        },
      });

      return prismaUserToUser(prismaUser);
    } catch (error: any) {
      // Some deployments still use the legacy users table without Prisma-added columns
      // (e.g., username/profile_picture). In that case, Prisma will throw because the
      // column list in the generated INSERT does not match the table definition.
      const errorMessage = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
      const columnMismatch =
        errorMessage.includes('column') &&
        (errorMessage.includes('username') ||
          errorMessage.includes('profile_picture') ||
          errorMessage.includes('hostel_id') ||
          errorMessage.includes('created_at'));

      if (columnMismatch || error?.code === 'P2010') {
        console.warn(
          '[UserModel] Falling back to pool.query for user.create due to Prisma column mismatch',
          error?.message || error
        );

        const result = await pool.query(
          `INSERT INTO users (email, name, password, role, hostel_id, password_is_temp)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, email, name, password, role, hostel_id, password_is_temp, created_at, updated_at`,
          [email, name, password, role, hostel_id ?? null, password_is_temp ?? false]
        );

        const row = result.rows[0];
        return {
          id: row.id,
          username: username || null,
          email: row.email,
          name: row.name,
          password: row.password,
          role: row.role,
          hostel_id: row.hostel_id,
          profile_picture: row.profile_picture ?? null,
          password_is_temp: row.password_is_temp ?? false,
          created_at: row.created_at,
          updated_at: row.updated_at,
        };
      }

      throw error;
    }
  }

  static async findByEmail(email: string): Promise<User | null> {
    const prismaUser = await prisma.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
      },
    });
    
    return prismaUser ? prismaUserToUser(prismaUser) : null;
  }

  static async findByUsername(username: string): Promise<User | null> {
    const prismaUser = await prisma.user.findFirst({
      where: {
        username: {
          equals: username,
          mode: 'insensitive',
        },
      },
    });
    
    return prismaUser ? prismaUserToUser(prismaUser) : null;
  }

  static async findByEmailAndRole(email: string, role: string): Promise<User | null> {
    const prismaUser = await prisma.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
        role: role as PrismaUser['role'],
      },
    });
    
    return prismaUser ? prismaUserToUser(prismaUser) : null;
  }

  static async findByEmailAndHostel(email: string, hostelId: number): Promise<User | null> {
    const prismaUser = await prisma.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
        hostelId,
      },
    });
    
    return prismaUser ? prismaUserToUser(prismaUser) : null;
  }

  static async findById(id: number): Promise<User | null> {
    const prismaUser = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        hostelId: true,
        username: true,
        profilePicture: true,
        passwordIsTemp: true,
        createdAt: true,
        updatedAt: true,
        password: false, // Don't return password by default
      },
    });
    
    if (!prismaUser) return null;
    
    // Add password field as empty string for type compatibility
    return {
      ...prismaUserToUser(prismaUser as PrismaUser),
      password: '',
    };
  }

  static async findByIdWithPassword(id: number): Promise<User | null> {
    const prismaUser = await prisma.user.findUnique({
      where: { id },
    });
    
    return prismaUser ? prismaUserToUser(prismaUser) : null;
  }

  static async updatePassword(id: number, hashedPassword: string): Promise<void> {
    await prisma.user.update({
      where: { id },
      data: {
        password: hashedPassword,
      },
    });
  }

  static async update(id: number, updateData: Partial<User>): Promise<User | null> {
    // Map our User interface fields to Prisma fields
    const prismaUpdateData: PrismaUserUpdateInput = {};
    
    if (updateData.username !== undefined) prismaUpdateData.username = updateData.username || null;
    if (updateData.email !== undefined) prismaUpdateData.email = updateData.email;
    if (updateData.name !== undefined) prismaUpdateData.name = updateData.name;
    if (updateData.role !== undefined) prismaUpdateData.role = updateData.role as PrismaUser['role'];
    if (updateData.hostel_id !== undefined) {
      if (updateData.hostel_id) {
        prismaUpdateData.hostel = { connect: { id: updateData.hostel_id } };
      } else {
        prismaUpdateData.hostel = { disconnect: true };
      }
    }
    if (updateData.profile_picture !== undefined) prismaUpdateData.profilePicture = updateData.profile_picture || null;
    if (updateData.password_is_temp !== undefined) prismaUpdateData.passwordIsTemp = updateData.password_is_temp;
    
    const prismaUser = await prisma.user.update({
      where: { id },
      data: prismaUpdateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        hostelId: true,
        username: true,
        profilePicture: true,
        createdAt: true,
        updatedAt: true,
        password: false,
      },
    });
    
    return {
      ...prismaUserToUser(prismaUser as PrismaUser),
      password: '',
    };
  }
}
