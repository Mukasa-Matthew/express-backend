import prisma from '../lib/prisma';
import { SubscriptionPlan as PrismaSubscriptionPlan, HostelSubscription as PrismaHostelSubscription, Prisma } from '@prisma/client';

export interface SubscriptionPlan {
  id: number;
  name: string;
  description: string;
  duration_months: number;
  price_per_month: number;
  total_price: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface HostelSubscription {
  id: number;
  hostel_id: number;
  plan_id: number;
  start_date: Date;
  end_date: Date;
  amount_paid: number;
  status: 'active' | 'expired' | 'cancelled';
  payment_method?: string | null;
  payment_reference?: string | null;
  created_at: Date;
  updated_at: Date;
}

// Helper functions
function prismaPlanToPlan(prismaPlan: PrismaSubscriptionPlan): SubscriptionPlan {
  return {
    id: prismaPlan.id,
    name: prismaPlan.name,
    description: prismaPlan.description || '',
    duration_months: prismaPlan.durationMonths,
    price_per_month: Number(prismaPlan.pricePerMonth || 0),
    total_price: Number(prismaPlan.totalPrice || 0),
    is_active: prismaPlan.isActive,
    created_at: prismaPlan.createdAt,
    updated_at: prismaPlan.updatedAt,
  };
}

function prismaSubscriptionToSubscription(
  prismaSub: PrismaHostelSubscription & { plan?: PrismaSubscriptionPlan }
): HostelSubscription & { plan_name?: string; duration_months?: number; total_price?: number } {
  return {
    id: prismaSub.id,
    hostel_id: prismaSub.hostelId,
    plan_id: prismaSub.planId,
    start_date: prismaSub.startDate,
    end_date: prismaSub.endDate,
    amount_paid: Number(prismaSub.amountPaid),
    status: prismaSub.status as HostelSubscription['status'],
    payment_method: prismaSub.paymentMethod,
    payment_reference: prismaSub.paymentReference,
    created_at: prismaSub.createdAt,
    updated_at: prismaSub.updatedAt,
    plan_name: prismaSub.plan?.name,
    duration_months: prismaSub.plan?.durationMonths,
    total_price: Number(prismaSub.plan?.totalPrice || 0),
  };
}

export class SubscriptionPlanModel {
  static async findAll(): Promise<SubscriptionPlan[]> {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { durationMonths: 'asc' },
    });
    
    return plans.map(prismaPlanToPlan);
  }

  static async findById(id: number): Promise<SubscriptionPlan | null> {
    const plan = await prisma.subscriptionPlan.findFirst({
      where: {
        id,
        isActive: true,
      },
    });
    
    return plan ? prismaPlanToPlan(plan) : null;
  }

  static async create(plan: Omit<SubscriptionPlan, 'id' | 'created_at' | 'updated_at'>): Promise<SubscriptionPlan> {
    const prismaPlan = await prisma.subscriptionPlan.create({
      data: {
        name: plan.name,
        description: plan.description,
        durationMonths: plan.duration_months,
        price: plan.total_price,
        pricePerMonth: plan.price_per_month,
        totalPrice: plan.total_price,
        isActive: plan.is_active,
        status: 'active',
        features: [],
      },
    });
    
    return prismaPlanToPlan(prismaPlan);
  }

  static async update(id: number, updates: Partial<SubscriptionPlan>): Promise<SubscriptionPlan | null> {
    const prismaUpdateData: Prisma.SubscriptionPlanUpdateInput = {};
    
    if (updates.name !== undefined) prismaUpdateData.name = updates.name;
    if (updates.description !== undefined) prismaUpdateData.description = updates.description;
    if (updates.duration_months !== undefined) prismaUpdateData.durationMonths = updates.duration_months;
    if (updates.price_per_month !== undefined) prismaUpdateData.pricePerMonth = updates.price_per_month;
    if (updates.total_price !== undefined) {
      prismaUpdateData.totalPrice = updates.total_price;
      prismaUpdateData.price = updates.total_price; // Also update price field
    }
    if (updates.is_active !== undefined) prismaUpdateData.isActive = updates.is_active;
    
    if (Object.keys(prismaUpdateData).length === 0) return null;
    
    const prismaPlan = await prisma.subscriptionPlan.update({
      where: { id },
      data: prismaUpdateData,
    });
    
    return prismaPlanToPlan(prismaPlan);
  }

  static async delete(id: number): Promise<boolean> {
    try {
      await prisma.subscriptionPlan.update({
        where: { id },
        data: {
          isActive: false,
          status: 'archived',
        },
      });
      return true;
    } catch (error: any) {
      if (error.code === 'P2025') return false;
      throw error;
    }
  }
}

export class HostelSubscriptionModel {
  static async create(subscription: Omit<HostelSubscription, 'id' | 'created_at' | 'updated_at'>): Promise<HostelSubscription> {
    const prismaSub = await prisma.hostelSubscription.create({
      data: {
        hostelId: subscription.hostel_id,
        planId: subscription.plan_id,
        startDate: subscription.start_date,
        endDate: subscription.end_date,
        amountPaid: subscription.amount_paid,
        status: subscription.status as PrismaHostelSubscription['status'],
        paymentMethod: subscription.payment_method || null,
        paymentReference: subscription.payment_reference || null,
      },
    });
    
    return prismaSubscriptionToSubscription(prismaSub);
  }

  static async findByHostelId(hostelId: number): Promise<(HostelSubscription & { plan_name?: string; duration_months?: number; total_price?: number })[]> {
    const subscriptions = await prisma.hostelSubscription.findMany({
      where: { hostelId },
      include: {
        plan: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    
    return subscriptions.map(prismaSubscriptionToSubscription);
  }

  static async findActiveByHostelId(hostelId: number): Promise<(HostelSubscription & { plan_name?: string; duration_months?: number; total_price?: number }) | null> {
    const subscription = await prisma.hostelSubscription.findFirst({
      where: {
        hostelId,
        status: 'active',
        endDate: { gt: new Date() },
      },
      include: {
        plan: true,
      },
      orderBy: { endDate: 'desc' },
    });
    
    return subscription ? prismaSubscriptionToSubscription(subscription) : null;
  }

  static async updateStatus(id: number, status: 'active' | 'expired' | 'cancelled'): Promise<boolean> {
    try {
      await prisma.hostelSubscription.update({
        where: { id },
        data: { status: status as PrismaHostelSubscription['status'] },
      });
      return true;
    } catch (error: any) {
      if (error.code === 'P2025') return false;
      throw error;
    }
  }

  static async getExpiredSubscriptions(): Promise<(HostelSubscription & { plan_name?: string; hostel_name?: string })[]> {
    const subscriptions = await prisma.hostelSubscription.findMany({
      where: {
        status: 'active',
        endDate: { lt: new Date() },
      },
      include: {
        plan: true,
        hostel: true,
      },
    });
    
    return subscriptions.map(sub => ({
      ...prismaSubscriptionToSubscription(sub),
      hostel_name: sub.hostel.name,
    }));
  }
}
