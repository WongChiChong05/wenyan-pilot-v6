import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getStore } from '@/lib/store';
import type { Participant } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** S0: consent + screening. Arm is NOT assigned here — it is assigned after the pretest. */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    chineseMajor: boolean;
    readBefore: boolean;
    grade?: string;
    department?: string;
    aiUsage?: string;
    consent: boolean;
  };
  if (!body.consent) return NextResponse.json({ error: 'consent required' }, { status: 400 });

  const now = new Date().toISOString();
  const p: Participant = {
    id: randomUUID(),
    token: randomUUID(),
    delayedToken: randomUUID(),
    arm: 'control', // placeholder; overwritten by stratified assignment after S1
    stage: 'S1',
    stratum: null,
    pretestScore: null,
    consentTs: now,
    demographics: {
      grade: body.grade ?? '',
      department: body.department ?? '',
      aiUsage: body.aiUsage ?? '',
      chineseMajor: body.chineseMajor,
      readBefore: body.readBefore,
    },
    excludeFlags: [
      ...(body.chineseMajor ? ['chinese_major'] : []),
      ...(body.readBefore ? ['read_before'] : []),
    ],
    stageEnteredTs: { S0: now, S1: now },
    completedTargets: [],
    active: null,
  };
  await getStore().createParticipant(p);
  return NextResponse.json({ token: p.token, eligible: p.excludeFlags.length === 0 });
}
