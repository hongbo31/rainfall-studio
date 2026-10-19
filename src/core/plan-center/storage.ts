import { createHash } from 'node:crypto';
import type { Repository } from '../database';
import { PlanCenterPlanSchema, PlanCenterRunRecordSchema, PlanCenterItemSchema, PlanCenterStageAttemptSchema, PlanCenterPublishAttemptSchema, PlanCenterOccurrenceSchema, PlanCenterAlbumBindingSchema, PlanCenterMigrationSchema } from '../../shared/plan-center';
import type { PlanCenterPlan, PlanCenterRun, PlanCenterItem, PlanCenterStageAttempt, PlanCenterPublishAttempt, PlanCenterOccurrence, PlanCenterAlbumBinding, PlanCenterMigration } from '../../shared/plan-center';
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value === 'object') return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value) ?? 'null';
}
export const digest = (v:unknown) => createHash('sha256').update(canonical(v)).digest('hex');
export type Entities = {plan:PlanCenterPlan;run:PlanCenterRun;item:PlanCenterItem;stage:PlanCenterStageAttempt;publish:PlanCenterPublishAttempt;occurrence:PlanCenterOccurrence;album:PlanCenterAlbumBinding;migration:PlanCenterMigration;cursor:{id:string;lastAt:string};owner:{id:string;kind:string;legacyId:string;planId:string;migrationId:string}};
const schemas = {plan:PlanCenterPlanSchema,run:PlanCenterRunRecordSchema,item:PlanCenterItemSchema,stage:PlanCenterStageAttemptSchema,publish:PlanCenterPublishAttemptSchema,occurrence:PlanCenterOccurrenceSchema,album:PlanCenterAlbumBindingSchema,migration:PlanCenterMigrationSchema};
export class CenterStore {
  constructor(readonly repo:Repository){}
  key(kind:keyof Entities,id:string) {return `plan-center:${kind}:${id}`;}
  get<K extends keyof Entities>(kind:K,id:string):Entities[K]|undefined {
    const value=this.repo.maybe('settings',this.key(kind,id))?.value;
    return value===undefined ? undefined : this.validate(kind,value);
  }
  all<K extends keyof Entities>(kind:K):Entities[K][] {
    const prefix=`plan-center:${kind}:`;
    return this.repo.all('settings').filter(r=>r.id.startsWith(prefix)).map(r=>this.validate(kind,r.value));
  }
  put<K extends keyof Entities>(kind:K,value:Entities[K]):Entities[K] {
    const parsed=this.validate(kind,value);this.repo.save('settings',{id:this.key(kind,parsed.id),value:parsed});return parsed;
  }
  remove(kind:keyof Entities,id:string) {this.repo.db.prepare('DELETE FROM settings WHERE id=?').run(this.key(kind,id));}
  private validate<K extends keyof Entities>(kind:K,value:unknown):Entities[K] {
    if(kind in schemas)return (schemas[kind as keyof typeof schemas].parse(value)) as Entities[K];
    if(!value||typeof value!=='object'||!('id' in value))throw Error('CORRUPT_PLAN_CENTER_RECORD');
    return value as Entities[K];
  }
}
export function isLegacyOwned(repo:Repository,kind:string,id:string) {
  const normalized=kind==='production-flow:plan'||kind==='productionFlow'?'production-flow':kind;
  return !!repo.maybe('settings',`plan-center:owner:${normalized}:${id}`)?.value;
}
