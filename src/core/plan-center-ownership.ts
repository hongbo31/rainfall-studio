import type {Repository} from './database';
import {isLegacyOwned} from './plan-center/storage';
export function planCenterOwnsScheduling(repo:Repository){
 return repo.all('settings').filter(r=>r.id.startsWith('plan-center:migration:')).at(-1)?.value?.state==='applied';
}
export function assertLegacyScheduleEditable(repo:Repository,kind:string,id?:string){
 if(planCenterOwnsScheduling(repo)||(id&&isLegacyOwned(repo,kind,id)))throw Error('PLAN_CENTER_OWNS_SCHEDULE');
}
