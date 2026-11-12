import {
  defaultFanqieAccountId,
  type PlatformAccount,
} from "../shared/platform-accounts";
import type { PlatformConfiguration } from "../shared/platform-config";

export function fanqieChoices(accounts: PlatformAccount[]) {
  return accounts
    .filter((account) => account.provider === "fanqie")
    .map((account) => ({ value: account.id, label: account.name }));
}

export function defaultFanqieChoice(
  choices: { value: string }[],
  configurations: PlatformConfiguration[] = [],
) {
  const configured = configurations.find(({ target }) => target === "fanqie")?.accountId;
  if (configured && choices.some(({ value }) => value === configured)) return configured;
  if (choices.some((choice) => choice.value === defaultFanqieAccountId))
    return defaultFanqieAccountId;
  return choices.length === 1 ? choices[0].value : "";
}

export function fanqieScope(accountId: string | undefined) {
  return accountId ? { accountId } : {};
}
