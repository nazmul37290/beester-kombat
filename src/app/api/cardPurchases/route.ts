import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import redis from '@/lib/redis';
import { Team } from '@/components/tasks/TaskList';

export async function POST(request: Request) {
  try {
    const { id, selectedTeam, points }: { id: string; selectedTeam: Team; points: number } = await request.json();

    if (!id || !selectedTeam )  {
      return NextResponse.json({ success: false, message: 'Invalid request data' }, { status: 400 });
    }

    // Fetch user and their purchased card in parallel
    const [user, purchaseCard, cardPrice] = await Promise.all([
      prisma.user.findUnique({ where: { chatId: id } }),
      prisma.userCard.findUnique({ where: { id: selectedTeam.id } }),
      prisma.cardPrice.findMany({})
    ]);

    if (!user) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }

    if(!cardPrice) {
      return NextResponse.json({ success: false, message: 'Card price not found' }, { status: 404 });
    }
    // Calculate new values
    const increasedBaseCost = Math.floor(selectedTeam.baseCost * cardPrice[0].price);
    const increasedBasePPH = Math.ceil(selectedTeam.basePPH * 1.05);
    const remainingPoints = points - selectedTeam.baseCost;

    if (remainingPoints < 0) {
      return NextResponse.json({ success: false, message: 'Insufficient points' }, { status: 400 });
    }

    let transactionResults;
    if (purchaseCard) {
      // Update existing user card and user points
      transactionResults = await prisma.$transaction([
        prisma.userCard.update({
          where: { id: selectedTeam.id },
          data: {
            baseLevel: { increment: 1 },
            basePPH: increasedBasePPH,
            baseCost: increasedBaseCost,
          },
        }),
        prisma.user.update({
          where: { chatId: id },
          data: {
            profitPerHour: { increment: selectedTeam.basePPH },
            points: remainingPoints,
            lastLogin: new Date(),
          },
        }),
       
      ]);
    } else {
      // Create a new user card and update user points
      transactionResults = await prisma.$transaction([
        prisma.userCard.create({
          data: {
            cardId: selectedTeam.id,
            title: selectedTeam.title,
            image: selectedTeam.image,
            baseLevel: 1,
            basePPH: increasedBasePPH,
            baseCost: increasedBaseCost,
            userId: id,
            category: selectedTeam.category,
          },
        }),
        prisma.user.update({
          where: { chatId: id },
          data: {
            profitPerHour: { increment: selectedTeam.basePPH },
            points: remainingPoints,
            lastLogin: new Date(),
          },
        }),
      ]);
    }
    
    console.log("🚀 ~ POST ~ transactionResults:", transactionResults)
    // Check if the userCards key exists
const userCardsKey = `userCards:${id}`;
const userCardsExists = await redis.exists(userCardsKey);

if (userCardsExists) {
  // Invalidate relevant Redis caches
  await redis.del(userCardsKey); // Invalidate user's card cache
  await redis.del('allCards'); // Invalidate the allCards cache
}



    return NextResponse.json({
      success: true,
      message: purchaseCard ? 'Card updated successfully' : 'Card created and user updated successfully',
      user: transactionResults[1],
      userCard: transactionResults[0],
    });
  } catch (error) {
    console.error('Error updating profit per hour:', error);
    return NextResponse.json(
      { success: false, message: 'An error occurred while updating the profit per hour' },
      { status: 500 }
    );
  }
}
