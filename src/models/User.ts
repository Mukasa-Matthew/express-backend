import prisma from '../lib/prisma';
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
    created_at: prismaUser.createdAt,
    updated_at: prismaUser.updatedAt,
  };
}

export class UserModel {
  static async create(userData: CreateUserData): Promise<User> {
    const { email, name, password, role, username, hostel_id } = userData;
    
    const prismaUser = await prisma.user.create({
      data: {
        email,
        name,
        password,
        role,
        username: username || null,
        hostelId: hostel_id || null,
      },
    });
    
    return prismaUserToUser(prismaUser);
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
