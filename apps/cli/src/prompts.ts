import { confirm, input, password, select } from "@inquirer/prompts";

export interface Prompts {
  input(o: { message: string; default?: string }): Promise<string>;
  password(o: { message: string }): Promise<string>;
  confirm(o: { message: string; default?: boolean }): Promise<boolean>;
  select<T extends string>(o: {
    message: string;
    choices: { name: string; value: T }[];
  }): Promise<T>;
}

/** Prompts render on stderr so stdout stays data-only. */
export function createInquirerPrompts(): Prompts {
  const context = { output: process.stderr };
  return {
    input: (o) => input(o, context),
    password: (o) => password({ message: o.message }, context),
    confirm: (o) => confirm(o, context),
    select: (o) => select(o, context),
  };
}
