import prisma from '../lib/prisma';
import { University as PrismaUniversity, Prisma } from '@prisma/client';

export interface University {
  id: number;
  name: string;
  code: string;
  region_id?: number | null;
  address?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  website?: string | null;
  status: 'active' | 'inactive' | 'suspended';
  created_at: Date;
  updated_at: Date;
}

export interface CreateUniversityData {
  name: string;
  code: string;
  region_id?: number;
  address?: string;
  contact_phone?: string;
  contact_email?: string;
  website?: string;
  status?: 'active' | 'inactive' | 'suspended';
}

export interface UpdateUniversityData {
  name?: string;
  code?: string;
  region_id?: number;
  address?: string;
  contact_phone?: string;
  contact_email?: string;
  website?: string;
  status?: 'active' | 'inactive' | 'suspended';
}

export interface Region {
  id: number;
  name: string;
  country: string;
  created_at: Date;
}

// Helper function to convert Prisma University to our University interface
function prismaUniversityToUniversity(prismaUni: PrismaUniversity & { region?: { name: string } | null }): University & { region_name?: string } {
  return {
    id: prismaUni.id,
    name: prismaUni.name,
    code: prismaUni.code || '',
    region_id: prismaUni.regionId,
    address: prismaUni.address,
    contact_phone: prismaUni.contactPhone,
    contact_email: prismaUni.contactEmail,
    website: prismaUni.website,
    status: prismaUni.status as University['status'],
    created_at: prismaUni.createdAt,
    updated_at: prismaUni.updatedAt,
    region_name: prismaUni.region?.name,
  };
}

export class UniversityModel {
  static async create(data: CreateUniversityData): Promise<University> {
    const prismaUni = await prisma.university.create({
      data: {
        name: data.name,
        code: data.code || null,
        regionId: data.region_id || null,
        address: data.address || null,
        contactPhone: data.contact_phone || null,
        contactEmail: data.contact_email || null,
        website: data.website || null,
        status: (data.status || 'active') as PrismaUniversity['status'],
      },
    });
    
    return prismaUniversityToUniversity(prismaUni);
  }

  static async findAll(): Promise<(University & { region_name?: string })[]> {
    const prismaUnis = await prisma.university.findMany({
      include: {
        region: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
    
    return prismaUnis.map(prismaUniversityToUniversity);
  }

  static async findById(id: number): Promise<(University & { region_name?: string }) | null> {
    const prismaUni = await prisma.university.findUnique({
      where: { id },
      include: {
        region: true,
      },
    });
    
    return prismaUni ? prismaUniversityToUniversity(prismaUni) : null;
  }

  static async update(id: number, data: UpdateUniversityData): Promise<University | null> {
    const prismaUpdateData: Prisma.UniversityUpdateInput = {};
    
    if (data.name !== undefined) prismaUpdateData.name = data.name;
    if (data.code !== undefined) prismaUpdateData.code = data.code || null;
    if (data.status !== undefined) prismaUpdateData.status = data.status as PrismaUniversity['status'];
    if (data.address !== undefined) prismaUpdateData.address = data.address || null;
    if (data.contact_phone !== undefined) prismaUpdateData.contactPhone = data.contact_phone || null;
    if (data.contact_email !== undefined) prismaUpdateData.contactEmail = data.contact_email || null;
    if (data.website !== undefined) prismaUpdateData.website = data.website || null;
    if (data.region_id !== undefined) {
      if (data.region_id) {
        prismaUpdateData.region = { connect: { id: data.region_id } };
      } else {
        prismaUpdateData.region = { disconnect: true };
      }
    }

    if (Object.keys(prismaUpdateData).length === 0) {
      return this.findById(id);
    }

    const prismaUni = await prisma.university.update({
      where: { id },
      data: prismaUpdateData,
    });
    
    return prismaUniversityToUniversity(prismaUni);
  }

  static async delete(id: number): Promise<boolean> {
    try {
      await prisma.university.delete({
        where: { id },
      });
      return true;
    } catch (error: any) {
      if (error.code === 'P2025') return false; // Record not found
      throw error;
    }
  }

  static async getRegions(): Promise<Region[]> {
    const regions = await prisma.region.findMany({
      orderBy: {
        name: 'asc',
      },
    });
    
    return regions.map(region => ({
      id: region.id,
      name: region.name,
      country: region.country,
      created_at: region.createdAt,
    }));
  }

  static async getUniversityStats(universityId?: number): Promise<any> {
    // For complex aggregations, use Prisma's query builder or raw query
    const whereClause = universityId ? { universityId } : {};
    
    // Get hostels
    const hostels = await prisma.hostel.findMany({
      where: whereClause,
      include: {
        users: {
          where: { role: 'user' },
        },
        rooms: true,
      },
    });

    // Get active room assignments
    const activeAssignments = await prisma.studentRoomAssignment.groupBy({
      by: ['roomId'],
      where: {
        status: 'active',
        room: {
          hostel: whereClause,
        },
      },
      _count: {
        id: true,
      },
    });

    const occupiedRoomsCount = activeAssignments.length;
    const totalHostels = hostels.length;
    const totalStudents = hostels.reduce((sum, h) => sum + h.users.length, 0);
    const totalRooms = hostels.reduce((sum, h) => sum + h.totalRooms, 0);
    const availableRooms = totalRooms - occupiedRoomsCount;
    const occupiedRooms = occupiedRoomsCount;
    const occupancyRate = totalRooms > 0 
      ? Math.round((occupiedRooms / totalRooms) * 100 * 100) / 100 
      : 0;

    return {
      total_hostels: totalHostels,
      total_students: totalStudents,
      total_rooms: totalRooms,
      available_rooms: availableRooms,
      occupied_rooms: occupiedRooms,
      occupancy_rate: occupancyRate,
    };
  }
}
