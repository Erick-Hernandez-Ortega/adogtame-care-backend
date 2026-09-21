export interface RegisterAccountCommand {
  email: string;
  password: string;
}

export interface RegisteredAccount {
  id: string;
  email: string;
}
