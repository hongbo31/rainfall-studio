import {
  defaultFanqieAccountId,
  type PlatformAccount,
} from "../shared/platform-accounts";

export function fanqieChoices(accounts: PlatformAccount[]) {
  return accounts
    .filter((account) => account.provider === "fanqie")
    .map((account) => ({ value: account.id, label: account.name }));
}

export function defaultFanqieChoice(choices: { value: string }[]) {
  if (choices.some((choice) => choice.value === defaultFanqieAccountId))
    return defaultFanqieAccountId;
  return choices.length === 1 ? choices[0].value : "";
}

export function fanqieScope(accountId: string | undefined) {
  return accountId ? { accountId } : {};
}
