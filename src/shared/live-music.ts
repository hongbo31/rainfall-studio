import {z} from 'zod';
export const LiveMusicInput=z.strictObject({
  requestId:z.uuid(),profileId:z.uuid(),expectedRevision:z.number().int().positive(),
  lyrics:z.string().min(100).max(5000),style:z.string().min(20).max(1000),duration:z.number().int().min(10).max(360),
  balanceBefore:z.literal(385),creditCap:z.literal(385),consent:z.literal(true),
});
export const liveMusicGrantKey='live-music-once:2026-10-16:leave-a-light';
