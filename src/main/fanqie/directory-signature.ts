import type {Page} from "playwright-core";
import {setTimeout as delay} from "node:timers/promises";
import {fanqieOrigin} from "../../shared/fanqie";
import type {FanqieCatalogRow} from "../../shared/fanqie-catalog";
import {assertFanqieAuthorizationLocation} from "./authorization";

type ContractWork = Pick<FanqieCatalogRow, "id" | "title">;
export type FanqieExistingSigningPage = {contractId:string; popup:Page};

export function fanqieContractUrl(contractId:string) {
  if (!/^[1-9]\d{4,24}$/u.test(contractId)) throw Error("FANQIE_EXISTING_CONTRACT_UNVERIFIED");
  return fanqieOrigin + "/creator/music/contract?menuid=authorize&contract_task_id=" + contractId;
}

/** Open the official signing link for an already created contract. Legal confirmation stays in the signer. */
export async function openFanqieContractLink(page:Page, contractId:string, works:readonly ContractWork[],
  recheck:()=>Promise<void>) {
  const url=fanqieContractUrl(contractId);
  const assertLocation=()=>{
    if(page.isClosed()||page.url()!==url)throw Error("FANQIE_AUTHORIZATION_SCOPE_CHANGED");
  };
  if(page.url()!==url)await page.goto(url,{waitUntil:"domcontentloaded",timeout:20_000});
  assertLocation();
  const openSigning=page.getByRole("button",{name:"签约合同",exact:true});
  const viewWorks=page.getByText("查看作品",{exact:true});
  // The official page resolves contract_task_id into its displayed contract number before filtering the initial table.
  const filter=page.getByPlaceholder("请输入合同ID",{exact:true}).filter({visible:true});
  const contractRows=page.getByRole("row").filter({has:openSigning,visible:true}).filter({has:viewWorks});
  const byNumber=(value:string)=>contractRows.filter({has:page.getByRole("cell",{name:value,exact:true})});
  let number="";
  const deadline=Date.now()+20_000;
  while(Date.now()<deadline){
    assertLocation();
    number=await filter.count()===1?(await filter.inputValue()).trim():"";
    if(number&&await byNumber(number).count()===1)break;
    await delay(250);
  }
  if(!number)throw Error("FANQIE_EXISTING_CONTRACT_UNAVAILABLE");
  const row=byNumber(number);
  if(await row.count()!==1||await row.getByText("查看作品",{exact:true}).count()!==1)
    throw Error("FANQIE_EXISTING_CONTRACT_UNVERIFIED");
  assertLocation();
  await row.getByText("查看作品",{exact:true}).click();
  const details=page.getByRole("dialog").filter({has:page.getByText("作品信息",{exact:true}),visible:true});
  await details.waitFor({state:"visible",timeout:10_000});
  const cells=await details.getByRole("row").filter({has:page.getByRole("cell")}).evaluateAll(rows=>rows.map(row=>
    [...row.querySelectorAll("td")].map(cell=>cell.innerText.trim())));
  const actual=cells.map(([title,id])=>[id,title].join("\n")).sort();
  const expected=works.map(({id,title})=>[id,title].join("\n")).sort();
  if(cells.some(row=>row.length!==2)||JSON.stringify(actual)!==JSON.stringify(expected))
    throw Error("FANQIE_AUTHORIZATION_WORK_MISMATCH");
  await details.getByRole("button",{name:"关闭",exact:true}).click();
  await details.waitFor({state:"hidden",timeout:5000});
  await recheck();
  assertLocation();
  const link=row.getByRole("button",{name:"签约合同",exact:true});
  if(await filter.count()!==1||(await filter.inputValue()).trim()!==number||await row.count()!==1||
      await link.count()!==1||!await link.isEnabled())
    throw Error("FANQIE_EXISTING_CONTRACT_UNAVAILABLE");
  const opening=page.waitForEvent("popup",{timeout:15_000});
  void opening.catch(()=>{});
  await link.click();
  const popup=await opening.catch(error=>{throw Error("FANQIE_EXISTING_CONTRACT_UNAVAILABLE",{cause:error});});
  assertLocation();
  if(await popup.opener()!==page)throw Error("FANQIE_AUTHORIZATION_SCOPE_CHANGED");
  return {contractId,popup};
}

export function isFanqieAuthorizationPage(page: Page) {
  if (page.isClosed()) return false;
  try {
    assertFanqieAuthorizationLocation(page);
    return true;
  } catch {
    return false;
  }
}

const linkNotReady = /未进入签约阶段[，,]\s*签约链接未生成/u;

/** Read only the signing page's public status labels. The caller checks its opener. */
export async function readFanqieSigningPage(page: Page) {
  if (page.isClosed()) return;
  const raw = page.url();
  const url = URL.canParse(raw) ? new URL(raw) : undefined;
  if (url?.protocol !== "https:" || url.username || url.password) return;

  try {
    if (linkNotReady.test(url.searchParams.get("text") ?? "") ||
        await page.getByText(linkNotReady).filter({visible: true}).count()) return "link_not_ready";
    const security = page.locator("span").and(page.getByText("数据安全验证", {exact: true})).filter({visible: true});
    const documentTitle = page.getByRole("heading", {name: "文件签署", exact: true, level: 2}).filter({visible: true});
    const signControl = page.locator(".ds-signature-base").or(page.getByRole("button", {name: "签署", exact: true})).filter({visible: true});
    const stage = await security.count() === 1 ? "security_verification" :
      await documentTitle.count() === 1 && await signControl.count() > 0 ? "signing" : undefined;
    if (stage && !page.isClosed() && page.url() === raw) return stage;
  } catch (error) {
    if (!page.isClosed() && page.url() === raw) throw error;
  }
}
