export type CustomerId = string;

export type CustomerRecord = {
  id: CustomerId;
  email: string;
  passwordHash: string;
  name: string;
  phone?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type RefreshTokenRecord = {
  id: string;
  token: string;
  customerId: CustomerId;
  expiresAt: Date;
  createdAt: Date;
};

export type RegisterCommand = {
  email: string;
  password: string;
  name: string;
  phone?: string;
};

export type LoginCommand = {
  email: string;
  password: string;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthResult = AuthTokens & {
  customerId: CustomerId;
  email: string;
  name: string;
};

export type CustomerView = {
  customerId: CustomerId;
  email: string;
  name: string;
  phone?: string;
};
