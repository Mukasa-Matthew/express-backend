import prisma from '../lib/prisma';
import { Hostel as PrismaHostel, Prisma } from '@prisma/client';
type PrismaHostelUpdateInput = Prisma.HostelUpdateInput;

export interface Hostel {
  id: number;
  name: string;
  address: string;
  description?: string | null;
  total_rooms: number;
  available_rooms: number;
  contact_phone?: string | null;
  contact_email?: string | null;
  status: 'active' | 'inactive' | 'maintenance' | 'suspended';
  university_id?: number | null;
  region_id?: number | null;
  distance_from_campus?: number | null;
  distance_walk_time?: string | null;
  amenities?: string | null;
  price_per_room?: number | null;
  rules_and_regulations?: string | null;
  occupancy_type?: 'male' | 'female' | 'mixed' | null;
  booking_fee?: number | null;
  current_subscription_id?: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateHostelData {
  name: string;
  address: string;
  description?: string;
  total_rooms: number;
  available_rooms: number;
  contact_phone?: string;
  contact_email?: string;
  status?: 'active' | 'inactive' | 'maintenance' | 'suspended';
  university_id?: number;
  region_id?: number;
  occupancy_type?: 'male' | 'female' | 'mixed' | null;
  amenities?: string;
  price_per_room?: number;
  distance_from_campus?: number;
  distance_walk_time?: string;
  booking_fee?: number;
}

export interface CreateHostelWithAdminData extends CreateHostelData {
  admin_name: string;
  admin_email: string;
  admin_phone: string;
  admin_address: string;
  subscription_plan_id: string;
}

// Helper function to convert Prisma Hostel to our Hostel interface
function prismaHostelToHostel(prismaHostel: PrismaHostel): Hostel {
  return {
    id: prismaHostel.id,
    name: prismaHostel.name,
    address: prismaHostel.address,
    description: prismaHostel.description,
    total_rooms: prismaHostel.totalRooms,
    available_rooms: prismaHostel.availableRooms,
    contact_phone: prismaHostel.contactPhone,
    contact_email: prismaHostel.contactEmail,
    status: prismaHostel.status as Hostel['status'],
    university_id: prismaHostel.universityId,
    region_id: prismaHostel.regionId,
    distance_from_campus:
      prismaHostel.distanceFromCampus !== null && prismaHostel.distanceFromCampus !== undefined
        ? Number(prismaHostel.distanceFromCampus)
        : null,
    distance_walk_time: prismaHostel.distanceWalkTime || null,
    amenities: prismaHostel.amenities,
    price_per_room: prismaHostel.pricePerRoom,
    rules_and_regulations: prismaHostel.rulesAndRegulations,
    occupancy_type: prismaHostel.occupancyType as Hostel['occupancy_type'],
    booking_fee:
      prismaHostel.bookingFee !== null && prismaHostel.bookingFee !== undefined
        ? Number(prismaHostel.bookingFee)
        : null,
    current_subscription_id: prismaHostel.currentSubscriptionId,
    created_at: prismaHostel.createdAt,
    updated_at: prismaHostel.updatedAt,
  };
}

export class HostelModel {
  static async create(hostelData: CreateHostelData): Promise<Hostel> {
    const {
      name,
      address,
      description,
      total_rooms,
      available_rooms,
      contact_phone,
      contact_email,
      status,
      university_id,
      occupancy_type,
      amenities,
      price_per_room,
      distance_from_campus,
      distance_walk_time,
      booking_fee,
    } = hostelData;

    const prismaHostel = await prisma.hostel.create({
      data: {
        name,
        address,
        description: description || null,
        totalRooms: total_rooms,
        availableRooms: available_rooms,
        contactPhone: contact_phone || null,
        contactEmail: contact_email || null,
        status: (status || 'active') as PrismaHostel['status'],
        universityId: university_id || null,
        occupancyType: occupancy_type || null,
        amenities: amenities || null,
        pricePerRoom: price_per_room ?? null,
        distanceFromCampus:
          distance_from_campus !== undefined && distance_from_campus !== null
            ? new Prisma.Decimal(distance_from_campus)
            : null,
        distanceWalkTime: distance_walk_time || null,
        bookingFee:
          booking_fee !== undefined && booking_fee !== null
            ? Math.round(Number(booking_fee))
            : null,
      },
    });

    return prismaHostelToHostel(prismaHostel);
  }

  static async findAll(): Promise<Hostel[]> {
    const prismaHostels = await prisma.hostel.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });

    return prismaHostels.map(prismaHostelToHostel);
  }

  static async findById(id: number): Promise<Hostel | null> {
    const prismaHostel = await prisma.hostel.findUnique({
      where: { id },
    });

    return prismaHostel ? prismaHostelToHostel(prismaHostel) : null;
  }

  static async update(id: number, hostelData: Partial<CreateHostelData>): Promise<Hostel | null> {
    const prismaUpdateData: PrismaHostelUpdateInput = {};

    if (hostelData.name !== undefined) prismaUpdateData.name = hostelData.name;
    if (hostelData.address !== undefined) prismaUpdateData.address = hostelData.address;
    if (hostelData.description !== undefined) prismaUpdateData.description = hostelData.description || null;
    if (hostelData.total_rooms !== undefined) prismaUpdateData.totalRooms = hostelData.total_rooms;
    if (hostelData.available_rooms !== undefined) prismaUpdateData.availableRooms = hostelData.available_rooms;
    if (hostelData.contact_phone !== undefined) prismaUpdateData.contactPhone = hostelData.contact_phone || null;
    if (hostelData.contact_email !== undefined) prismaUpdateData.contactEmail = hostelData.contact_email || null;
    if (hostelData.status !== undefined) prismaUpdateData.status = hostelData.status as PrismaHostel['status'];
    if (hostelData.university_id !== undefined) {
      if (hostelData.university_id) {
        prismaUpdateData.university = { connect: { id: hostelData.university_id } };
      } else {
        prismaUpdateData.university = { disconnect: true };
      }
    }
    if (hostelData.region_id !== undefined) {
      if (hostelData.region_id) {
        prismaUpdateData.region = { connect: { id: hostelData.region_id } };
      } else {
        prismaUpdateData.region = { disconnect: true };
      }
    }
    if (hostelData.occupancy_type !== undefined) prismaUpdateData.occupancyType = hostelData.occupancy_type || null;
    if (hostelData.amenities !== undefined) prismaUpdateData.amenities = hostelData.amenities || null;
    if (hostelData.price_per_room !== undefined) prismaUpdateData.pricePerRoom = hostelData.price_per_room ?? null;
    if (hostelData.distance_from_campus !== undefined) {
      prismaUpdateData.distanceFromCampus =
        hostelData.distance_from_campus !== null && hostelData.distance_from_campus !== undefined
          ? new Prisma.Decimal(hostelData.distance_from_campus)
          : null;
    }
    if (hostelData.distance_walk_time !== undefined) prismaUpdateData.distanceWalkTime = hostelData.distance_walk_time || null;
    if (hostelData.booking_fee !== undefined) {
      prismaUpdateData.bookingFee =
        hostelData.booking_fee !== null && hostelData.booking_fee !== undefined
          ? Math.round(Number(hostelData.booking_fee))
          : null;
    }

    const prismaHostel = await prisma.hostel.update({
      where: { id },
      data: prismaUpdateData,
    });

    return prismaHostelToHostel(prismaHostel);
  }

  static async delete(id: number): Promise<boolean> {
    const result = await prisma.hostel.delete({
      where: { id },
    });

    return !!result;
  }

  static async getHostelStats(): Promise<{
    total_hostels: number;
    active_hostels: number;
    total_rooms: number;
    available_rooms: number;
  }> {
    // Use Prisma's aggregate and raw query for complex stats
    const [totalStats, activeAssignments] = await Promise.all([
      prisma.hostel.aggregate({
        _count: {
          id: true,
        },
        _sum: {
          totalRooms: true,
        },
        where: {
          status: 'active',
        },
      }),
      prisma.studentRoomAssignment.groupBy({
        by: ['roomId'],
        where: {
          status: 'active',
        },
        _count: {
          id: true,
        },
      }),
    ]);

    const occupiedRoomsCount = activeAssignments.length;
    const totalHostels = await prisma.hostel.count();
    const activeHostels = await prisma.hostel.count({
      where: { status: 'active' },
    });
    const totalRooms = totalStats._sum.totalRooms || 0;
    const availableRooms = totalRooms - occupiedRoomsCount;

    return {
      total_hostels: totalHostels,
      active_hostels: activeHostels,
      total_rooms: totalRooms,
      available_rooms: availableRooms,
    };
  }
}
