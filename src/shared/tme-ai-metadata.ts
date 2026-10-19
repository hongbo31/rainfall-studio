import {z} from 'zod';
const text=z.string().trim().min(1).max(1000);
export const TmeAiPrepareMetadataSchema=z.strictObject({title:text,albumMode:z.enum(['existing','new']).optional(),albumTitle:text,albumDescription:z.string().trim().min(1).max(10000),artistName:text,lyricist:text,composer:text,ownLyrics:z.boolean(),ownComposition:z.boolean(),aiTool:text,generatedOn:z.iso.date(),allowCover:z.boolean(),genre:text,language:text,version:text,releaseMode:text});
