export interface AuthenticateAccountCommand {
  email: string;
  password: string;
}

export interface AuthenticatedAccount {
  accessToken: string;
}
