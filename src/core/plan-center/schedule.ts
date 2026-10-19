import { DateTime } from 'luxon';
import type { PlanCenterPlan } from '../../shared/plan-center';
// Work backwards from the current local date, so even a multi-year outage has a bounded scan.
export function dueTimes(plan:PlanCenterPlan,after:string,now:string):string[] {
  const end=DateTime.fromISO(now).setZone('Asia/Shanghai'),start=DateTime.fromISO(after);
  const [hour,minute]=plan.schedule.localTime.split(':').map(Number),out:string[]=[];
  if(plan.schedule.kind==='once') {
    const d=DateTime.fromISO(`${plan.schedule.date}T${plan.schedule.localTime}`,{zone:'Asia/Shanghai'});
    if(d.isValid&&d.toMillis()>start.toMillis()&&d.toMillis()<=end.toMillis())out.push(d.toUTC().toISO()!);
    return out;
  }
  for(let n=0;n<50&&out.length<5;n++) {
    const d=end.startOf('day').minus({days:n}).set({hour,minute});
    if(d.toMillis()<=start.toMillis())break;
    if(d.toMillis()>end.toMillis())continue;
    if(plan.schedule.kind==='weekly'&&!plan.schedule.weekdays.includes(d.weekday))continue;
    out.push(d.toUTC().toISO()!);
  }
  return out.reverse();
}
